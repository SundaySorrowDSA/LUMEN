import webpush from "web-push";
import { and, eq, like, lte } from "drizzle-orm";
import {
  assistantPushSubscriptionsTable,
  assistantRemindersTable,
  assistantMessagesTable,
  assistantConversationsTable,
  reminderPushReceiptsTable,
  db,
} from "@workspace/db";
import { getPrivacyMode } from "./privacy-mode.js";
import { REMINDER_NOTIFICATION_GRACE_MS } from "./reminder-notification-policy.js";
import { deliverReminder, findOriginFromCreationMetadata } from "./reminder-delivery.js";
import { logger } from "../lib/logger.js";

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.replace(/\s+/g, "");
  const privateKey = process.env.VAPID_PRIVATE_KEY?.replace(/\s+/g, "");
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey };
  } catch {
    return null;
  }
}

export function getPushConfiguration() {
  const configuration = configureWebPush();
  return configuration
    ? { configured: true as const, publicKey: configuration.publicKey }
    : { configured: false as const, publicKey: null };
}

export async function savePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS");
  const [saved] = await db
    .insert(assistantPushSubscriptionsTable)
    .values({
      endpoint: endpoint.toString(),
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: assistantPushSubscriptionsTable.endpoint,
      set: {
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        updatedAt: new Date(),
      },
    })
    .returning({ id: assistantPushSubscriptionsTable.id });
  return saved;
}

export async function removePushSubscription(endpointValue: string) {
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS");
  await db
    .delete(assistantPushSubscriptionsTable)
    .where(eq(assistantPushSubscriptionsTable.endpoint, endpoint.toString()));
}

export function claimReminderQuery(database: Pick<typeof db, "select">, id: number, now: Date) {
  return database.select().from(assistantRemindersTable).where(and(
    eq(assistantRemindersTable.id, id),
    eq(assistantRemindersTable.status, "pending"),
    lte(assistantRemindersTable.dueAt, now),
  )).for("update", { skipLocked: true });
}

export async function deliverDueReminderNotifications(now = new Date()) {
  const pushConfigured = Boolean(configureWebPush());
  const privacy = await getPrivacyMode();
  const [subscriptions, reminders] = await Promise.all([
    db.select().from(assistantPushSubscriptionsTable),
    db
      .select()
      .from(assistantRemindersTable)
      .where(and(
        eq(assistantRemindersTable.status, "pending"),
        lte(assistantRemindersTable.dueAt, now),
      )).orderBy(assistantRemindersTable.dueAt),
  ]);
  const summary = {
    reminders: 0, subscriptions: subscriptions.length, delivered: 0,
    chatDelivered: 0, failed: 0, expired: 0, suppressed: privacy.darkMode,
  };
  const log = (stage: string, fields: Record<string, unknown> = {}) => {
    const details = { component: "reminder-worker", stage, ...fields };
    if (stage.includes("failed")) logger.warn(details, "Reminder worker event");
    else logger.info(details, "Reminder worker event");
  };

  log("worker_started", { candidates: reminders.length, subscriptions: subscriptions.length, pushConfigured });
  for (const candidate of reminders) {
    try {
      // One reminder per transaction: overlapping cron/All Clear calls skip
      // locked rows. Chat insertion + timestamp + accepted receipts are atomic.
      // Web Push itself cannot join a DB transaction; see setup documentation.
      const committedLogs: Array<{ stage: string; fields: Record<string, unknown> }> = [];
      const result = await db.transaction(async tx => {
        const [reminder] = await claimReminderQuery(tx, candidate.id, now);
        if (!reminder) return null;
        return deliverReminder(reminder, {
          clock: () => new Date(),
          log: (stage, fields = {}) => {
            const details = { reminderId: reminder.id, ...fields };
            if (stage === "chat_delivered") committedLogs.push({ stage, fields: details });
            else log(stage, details);
          },
          save: async patch => { await tx.update(assistantRemindersTable).set(patch).where(eq(assistantRemindersTable.id, reminder.id)); },
          findOrigin: async () => {
            // Legacy reminders predate conversation_id. Use ONLY unique,
            // verified creation metadata; never guess the active conversation.
            const messages = await tx.select({
              conversationId: assistantMessagesTable.conversationId,
              metadata: assistantMessagesTable.metadata,
            }).from(assistantMessagesTable).where(and(
              eq(assistantMessagesTable.role, "assistant"),
              like(assistantMessagesTable.metadata, "%persistent-reminders%"),
            ));
            const id = findOriginFromCreationMetadata(reminder.id, messages);
            if (id === null) return null;
            const [conversation] = await tx.select({ id: assistantConversationsTable.id })
              .from(assistantConversationsTable).where(eq(assistantConversationsTable.id, id));
            return conversation?.id ?? null;
          },
          insertChat: async (conversationId, content, at) => {
            await tx.insert(assistantMessagesTable).values({
              conversationId, role: "assistant", content, model: "Lumen reminder",
              createdAt: at,
              metadata: JSON.stringify({
                providerId: "lumen-reminder-worker", mode: "tool", route: "reminder-delivery",
                reminderId: reminder.id, dueAt: reminder.dueAt.toISOString(),
                tools: [{ id: "persistent-reminders", action: "deliver-chat", status: "delivered", reminderIds: [reminder.id] }],
              }),
            });
            await tx.update(assistantConversationsTable).set({ updatedAt: at })
              .where(eq(assistantConversationsTable.id, conversationId));
          },
          acceptedSubscriptions: async () => (await tx.select({
            id: reminderPushReceiptsTable.subscriptionId,
          }).from(reminderPushReceiptsTable).where(eq(reminderPushReceiptsTable.reminderId, reminder.id))).map(row => row.id),
          send: async subscriptionId => {
            const subscription = subscriptions.find(row => row.id === subscriptionId)!;
            const response = await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            }, JSON.stringify({
              title: "Lumen reminder", body: reminder.text,
              reminderId: reminder.id, dueAt: reminder.dueAt.toISOString(),
            }), {
              TTL: Math.max(1, Math.ceil((reminder.dueAt.getTime() + REMINDER_NOTIFICATION_GRACE_MS - Date.now()) / 1000)),
              urgency: "high", timeout: 8_000,
            });
            log("push_service_response", {
              reminderId: reminder.id, subscriptionId,
              pushServiceHost: new URL(subscription.endpoint).hostname,
              httpStatus: response.statusCode,
            });
          },
          recordAcceptance: async (subscriptionId, at) => {
            await tx.insert(reminderPushReceiptsTable).values({
              reminderId: reminder.id, subscriptionId, acceptedAt: at,
            }).onConflictDoNothing();
          },
          removeInvalidSubscription: async id => {
            await tx.delete(assistantPushSubscriptionsTable).where(eq(assistantPushSubscriptionsTable.id, id));
          },
        }, { subscriptionIds: subscriptions.map(row => row.id), pushConfigured, darkMode: privacy.darkMode });
      });
      if (!result) { log("reminder_skipped", { reminderId: candidate.id, reason: "locked_or_already_processed" }); continue; }
      for (const event of committedLogs) log(event.stage, event.fields);
      log("reminder_committed", { reminderId: candidate.id });
      summary.reminders++;
      summary.chatDelivered += result.chatDelivered;
      summary.delivered += result.delivered;
      summary.failed += result.failed;
      summary.expired += result.expired;
    } catch {
      summary.failed++;
      log("reminder_failed", { reminderId: candidate.id, reason: "transaction_rolled_back", retryable: true });
    }
  }
  log("worker_completed", summary);
  return summary;
}