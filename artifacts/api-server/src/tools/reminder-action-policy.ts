import type { ReminderToolResult } from "./reminders.js";

export class UnverifiedManagedActionError extends Error {
  constructor() {
    super("I couldn't verify that a reminder, timer, or notification was created. Please use an explicit reminder request; an unconfirmed provider acknowledgement is not a saved reminder.");
  }
}

export function hasReminderCreationEvidence(result: ReminderToolResult | null): boolean {
  return result?.tool === "persistent-reminders" && result.action === "create" &&
    result.status === "created" && result.reminders.length === 1 &&
    Number.isInteger(result.reminders[0].id) && result.reminders[0].id > 0 &&
    Boolean(result.reminders[0].text.trim()) &&
    Number.isFinite(Date.parse(result.reminders[0].dueAt));
}

/** A conversational provider cannot manufacture the tool result needed here.
 * A saved record confirms creation, not eventual push delivery.
 */
export function buildVerifiedReminderReply(result: ReminderToolResult | null) {
  if (!result || result.tool !== "persistent-reminders") throw new UnverifiedManagedActionError();
  let content: string;
  if (result.action === "create") {
    if (!hasReminderCreationEvidence(result)) throw new UnverifiedManagedActionError();
    const reminder = result.reminders[0];
    content = `Saved reminder #${reminder.id}: ${reminder.text}. Due ${reminder.displayTime} (${reminder.dueAt}).`;
  } else if (result.action === "list" && result.status === "listed") {
    content = result.reminders.length
      ? result.reminders.map(reminder => `Reminder #${reminder.id}: ${reminder.text} — ${reminder.displayTime} (${reminder.dueAt}).`).join("\n")
      : "There are no pending reminders.";
  } else if (result.action === "cancel" && result.status === "cancelled" && result.reminders.length === 1) {
    content = `Cancelled reminder #${result.reminders[0].id}: ${result.reminders[0].text}.`;
  } else if (result.action === "cancel" && result.status === "ambiguous") {
    content = "More than one reminder matched. Nothing was cancelled; please specify the reminder ID.";
  } else if (result.action === "cancel" && result.status === "not-found") {
    content = "No matching pending reminder was found. Nothing was cancelled.";
  } else {
    throw new UnverifiedManagedActionError();
  }
  return {
    providerId: "lumen-reminder-tool",
    model: "Lumen reminder tool",
    content,
    metadata: { mode: "tool" as const, routedBy: "reminder-tool" },
  };
}

export function managedActionGroundingContext(content: string): string {
  return `${content}\n\n[Lumen managed-action execution facts]
No reminder, timer, alarm, scheduled action, or notification was created by Lumen for this request.
Do not say these actions succeeded or promise to remind, notify, or alert the user later.
If the user wants a reminder, ask them to use “Remind me in 75 seconds to …” with their actual duration and task.
[End Lumen execution facts]`;
}

/** Reject the whole unsupported acknowledgement before persistence. This does
 * not edit or keyword-rewrite the provider's prose. Tool-driven reminder
 * responses bypass the conversational provider entirely.
 */
export function assertManagedActionAcknowledgement(
  content: string,
  reminder: ReminderToolResult | null,
): void {
  const creationClaim = /(?<!\bno\s)\b(?:reminder|timer|alarm|scheduled\s+action)\s+(?:(?:is|was|has\s+been|successfully|now|already)\s+)*(?:set|created|scheduled|activated)\b|\bI(?:['’]ve|\s+have)?\s+(?:(?:already|just|successfully)\s+)*(?:set|created|scheduled|activated)\s+(?:(?:a|the|your)\s+)?(?:reminder|timer|alarm|scheduled\s+action)\b|\b[0-9]+\s+(?:seconds?|minutes?|hours?)\s+(?:are\s+)?on\s+(?:the\s+)?clock\b/i;
  const deliveryClaim = /(?<!\bno\s)\bnotification\s+(?:(?:is|was|has\s+been|successfully|now|already)\s+)*(?:set|created|scheduled|sent|enabled)\b|\bI(?:['’]ve|\s+have)?\s+(?:(?:already|just|successfully)\s+)*(?:sent|scheduled|created|enabled)\s+(?:(?:a|the|your)\s+)?notification\b|\bI(?:['’]ll|\s+will)\s+(?:remind|notify|alert)\s+you\b(?!\s+(?:how|what|why|who|where|of|about|that)\b)/i;
  if (deliveryClaim.test(content) || (creationClaim.test(content) && !hasReminderCreationEvidence(reminder))) {
    throw new UnverifiedManagedActionError();
  }
}

/** This is the actual provider/tool boundary used by the chat route. A missing
 * or failed result for a routed reminder is never replaced with provider text.
 */
export async function completeGroundedReply<T extends { content: string }>(
  reminderRequested: boolean,
  reminder: ReminderToolResult | null,
  completeProvider: () => Promise<T>,
) {
  if (reminderRequested) return buildVerifiedReminderReply(reminder);
  const reply = await completeProvider();
  assertManagedActionAcknowledgement(reply.content, null);
  return reply;
}
