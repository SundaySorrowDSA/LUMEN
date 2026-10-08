import type { AssistantReminder } from "@workspace/db";
import { isReminderFreshEnough } from "./reminder-notification-policy.js";

export type DeliveryReminder = Pick<AssistantReminder,
  "id" | "text" | "dueAt" | "conversationId" | "chatStatus" | "chatDeliveredAt" |
  "pushStatus" | "pushAttemptedAt" | "pushLastError" | "notificationSentAt" | "status">;

export interface ReminderDeliveryPort {
  clock(): Date;
  log(stage: string, fields?: Record<string, string | number | boolean | null>): void;
  save(patch: Partial<DeliveryReminder>): Promise<void>;
  findOrigin(): Promise<number | null>;
  insertChat(conversationId: number, content: string, at: Date): Promise<void>;
  acceptedSubscriptions(): Promise<number[]>;
  send(subscriptionId: number): Promise<void>;
  recordAcceptance(subscriptionId: number, at: Date): Promise<void>;
  removeInvalidSubscription(subscriptionId: number): Promise<void>;
}

/** No endpoints, keys, provider bodies, or exception messages enter logs/state. */
export function pushFailureCode(error: unknown): { code: string; status: number } {
  const status = typeof error === "object" && error && "statusCode" in error
    ? Number(error.statusCode) : 0;
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  return { code: safeStatus ? `http_${safeStatus}` : "transport_error", status: safeStatus };
}

export function findOriginFromCreationMetadata(
  reminderId: number,
  messages: Array<{ conversationId: number; metadata: string | null }>,
): number | null {
  const origins = new Set<number>();
  for (const message of messages) {
    try {
      const tools = JSON.parse(message.metadata ?? "{}").tools;
      if (Number.isInteger(message.conversationId) && message.conversationId > 0 &&
          Array.isArray(tools) && tools.some(tool => tool && typeof tool === "object" &&
            tool.id === "persistent-reminders" && tool.action === "create" &&
            tool.status === "created" && Array.isArray(tool.reminderIds) &&
            tool.reminderIds.includes(reminderId))) origins.add(message.conversationId);
    } catch { /* Malformed metadata is not evidence. */ }
  }
  return origins.size === 1 ? [...origins][0] : null;
}

export async function deliverReminder(
  reminder: DeliveryReminder,
  port: ReminderDeliveryPort,
  options: { subscriptionIds: number[]; pushConfigured: boolean; darkMode: boolean },
) {
  const result = { chatDelivered: 0, delivered: 0, failed: 0, expired: 0 };
  const save = async (patch: Partial<DeliveryReminder>) => {
    await port.save(patch);
    Object.assign(reminder, patch);
  };
  port.log("reminder_selected", { dueAt: reminder.dueAt.toISOString(), conversationId: reminder.conversationId });

  if (!reminder.chatDeliveredAt && reminder.chatStatus !== "unlinked") {
    const conversationId = reminder.conversationId ?? await port.findOrigin();
    if (conversationId === null) {
      await save({ chatStatus: "unlinked" });
      port.log("chat_failed", { reason: "origin_not_uniquely_identified" });
      result.failed++;
    } else {
      const now = port.clock();
      const prefix = isReminderFreshEnough(reminder.dueAt, now) ? "Reminder" : "Overdue reminder";
      const due = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", dateStyle: "full", timeStyle: "long",
      }).format(reminder.dueAt);
      // The adapter commits this insert and delivery state in ONE transaction.
      port.log("chat_attempted", { conversationId });
      try {
        await port.insertChat(conversationId, `${prefix}: ${reminder.text}\nScheduled for ${due}.`, now);
        await save({ conversationId, chatStatus: "delivered", chatDeliveredAt: now });
      } catch {
        port.log("chat_failed", { reason: "chat_transaction_failed", conversationId });
        throw new Error("chat_transaction_failed");
      }
      port.log("chat_delivered", { conversationId });
      result.chatDelivered++;
    }
  }

  if (!["delivered", "expired"].includes(reminder.pushStatus)) {
    if (!isReminderFreshEnough(reminder.dueAt, port.clock())) {
      await save({ pushStatus: "expired", pushLastError: null });
      port.log("push_expired", { reason: "outside_three_minute_window" });
      result.expired++;
    } else if (options.darkMode) {
      port.log("push_suppressed", { reason: "dark_mode" });
    } else if (!options.pushConfigured || !options.subscriptionIds.length) {
      const code = options.pushConfigured ? "no_subscriptions" : "push_not_configured";
      await save({ pushStatus: "failed", pushLastError: code });
      port.log("push_failed", { reason: code });
      result.failed++;
    } else {
      const accepted = new Set(await port.acceptedSubscriptions());
      let failures = 0;
      for (const subscriptionId of options.subscriptionIds) {
        if (accepted.has(subscriptionId)) {
          port.log("push_retry_skipped", { subscriptionId, reason: "already_accepted" });
          continue;
        }
        // A slow earlier send must not permit late sends to the next device.
        if (!isReminderFreshEnough(reminder.dueAt, port.clock())) break;
        const at = port.clock();
        await save({ pushAttemptedAt: at });
        port.log("push_attempted", { subscriptionId });
        try {
          await port.send(subscriptionId);
        } catch (error) {
          failures++;
          const { code, status } = pushFailureCode(error);
          await save({ pushLastError: code });
          port.log("push_failed", { subscriptionId, httpStatus: status, reason: code });
          if (status === 404 || status === 410) await port.removeInvalidSubscription(subscriptionId);
          result.failed++;
          continue;
        }
        // Database errors here must roll back, not masquerade as transport errors.
        await port.recordAcceptance(subscriptionId, at);
        accepted.add(subscriptionId);
        await save({ notificationSentAt: reminder.notificationSentAt ?? at });
        port.log("push_accepted", { subscriptionId });
        result.delivered++;
      }
      const allAccepted = options.subscriptionIds.every(id => accepted.has(id));
      const expired = !allAccepted && !isReminderFreshEnough(reminder.dueAt, port.clock());
      await save({
        pushStatus: allAccepted ? "delivered" : expired ? "expired" : accepted.size ? "partial" : "failed",
        pushLastError: allAccepted ? null : reminder.pushLastError,
      });
      if (expired) { port.log("push_expired", { reason: "window_elapsed_during_delivery" }); result.expired++; }
      port.log("push_result", { accepted: accepted.size, failures, pushStatus: reminder.pushStatus });
    }
  }

  if (["delivered", "unlinked"].includes(reminder.chatStatus) &&
      ["delivered", "expired"].includes(reminder.pushStatus)) {
    // "completed" means processing finished, NOT that both channels delivered.
    await save({ status: "completed" });
  }
  return result;
}
