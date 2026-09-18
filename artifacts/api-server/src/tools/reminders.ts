import { and, eq, gt } from "drizzle-orm";
import { assistantRemindersTable, db } from "@workspace/db";

export type ReminderToolResult = {
  tool: "persistent-reminders";
  action: "create" | "list" | "cancel";
  status: "created" | "listed" | "cancelled" | "not-found" | "ambiguous";
  reminders: Array<{
    id: number;
    text: string;
    dueAt: string;
    displayTime: string;
  }>;
};

const REMINDER_INTENT =
  /\bremind\s+me\b|\b(?:list|show|check|what(?:'s|\s+are)?)\b[\s\S]*\breminders?\b|\b(?:cancel|delete|remove)\b[\s\S]*\breminder\b/i;
const DEFAULT_TIME_ZONE = "America/New_York";
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function requiresReminderTool(message: string): boolean {
  return REMINDER_INTENT.test(message);
}

function reminderAction(message: string): ReminderToolResult["action"] {
  if (/\b(?:cancel|delete|remove)\b/i.test(message)) return "cancel";
  if (/\bremind\s+me\b/i.test(message)) return "create";
  return "list";
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday).toLowerCase(),
  };
}

function zonedLocalToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const desiredUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    guess += desiredUtc - observedUtc;
  }
  return new Date(guess);
}

function parseReminderDateTime(message: string, now: Date): Date | null {
  const timeMatch = message.match(
    /\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(AM|PM)\b/i,
  );
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]) % 12;
  if (timeMatch[3].toUpperCase() === "PM") hour += 12;
  const minute = Number(timeMatch[2] ?? 0);
  if (minute > 59) return null;

  const today = zonedDateParts(now, DEFAULT_TIME_ZONE);
  let target = new Date(Date.UTC(today.year, today.month - 1, today.day, 12));
  if (/\btomorrow\b/i.test(message)) {
    target.setUTCDate(target.getUTCDate() + 1);
  } else {
    const weekday = WEEKDAYS.find((day) => new RegExp(`\\b${day}\\b`, "i").test(message));
    if (weekday) {
      const currentIndex = WEEKDAYS.indexOf(today.weekday);
      let offset = WEEKDAYS.indexOf(weekday) - currentIndex;
      if (offset <= 0) offset += 7;
      target.setUTCDate(target.getUTCDate() + offset);
    } else {
      const monthMatch = message.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2})(?:,\s*([0-9]{4}))?/i,
      );
      if (monthMatch) {
        const monthNames = [
          "january", "february", "march", "april", "may", "june",
          "july", "august", "september", "october", "november", "december",
        ];
        target = new Date(Date.UTC(
          Number(monthMatch[3] ?? today.year),
          monthNames.indexOf(monthMatch[1].toLowerCase()),
          Number(monthMatch[2]),
          12,
        ));
      } else if (!/\btoday\b/i.test(message)) {
        return null;
      }
    }
  }

  return zonedLocalToUtc(
    {
      year: target.getUTCFullYear(),
      month: target.getUTCMonth() + 1,
      day: target.getUTCDate(),
      hour,
      minute,
    },
    DEFAULT_TIME_ZONE,
  );
}

function extractReminderText(message: string): string | null {
  const afterDate = message.match(
    /\bremind\s+me\b[\s\S]*?\bto\s+(.+?)\s*$/i,
  )?.[1];
  if (afterDate) return afterDate.trim().replace(/[.!?]+$/, "").slice(0, 500);
  const beforeDate = message.match(
    /\bremind\s+me\s+to\s+(.+?)(?=\s+(?:today|tomorrow|on\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|at\s+[0-9]))/i,
  )?.[1];
  return beforeDate?.trim().replace(/[.!?]+$/, "").slice(0, 500) || null;
}

function displayReminder(reminder: typeof assistantRemindersTable.$inferSelect) {
  return {
    id: reminder.id,
    text: reminder.text,
    dueAt: reminder.dueAt.toISOString(),
    displayTime: new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIME_ZONE,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(reminder.dueAt),
  };
}

async function listPendingReminders() {
  return db
    .select()
    .from(assistantRemindersTable)
    .where(and(
      eq(assistantRemindersTable.status, "pending"),
      gt(assistantRemindersTable.dueAt, new Date()),
    ))
    .orderBy(assistantRemindersTable.dueAt);
}

export async function runReminderTool(message: string): Promise<ReminderToolResult> {
  const action = reminderAction(message);
  if (action === "create") {
    const text = extractReminderText(message);
    const dueAt = parseReminderDateTime(message, new Date());
    if (!text || !dueAt || dueAt <= new Date()) {
      throw new Error("Reminder requests need a future date, time, and reminder text");
    }
    const [created] = await db
      .insert(assistantRemindersTable)
      .values({ text, dueAt, status: "pending" })
      .returning();
    return {
      tool: "persistent-reminders",
      action,
      status: "created",
      reminders: [displayReminder(created)],
    };
  }

  const pending = await listPendingReminders();
  if (action === "list") {
    return {
      tool: "persistent-reminders",
      action,
      status: "listed",
      reminders: pending.map(displayReminder),
    };
  }

  const id = Number(message.match(/\breminder\s+#?([0-9]+)\b/i)?.[1]);
  const description = message
    .replace(/\b(?:cancel|delete|remove)\b/gi, "")
    .replace(/\b(?:the|my|reminder)\b/gi, "")
    .replace(/[.!?]+/g, "")
    .trim()
    .toLowerCase();
  const matches = Number.isInteger(id) && id > 0
    ? pending.filter((reminder) => reminder.id === id)
    : pending.filter((reminder) => description && reminder.text.toLowerCase().includes(description));
  if (matches.length !== 1) {
    return {
      tool: "persistent-reminders",
      action,
      status: matches.length > 1 ? "ambiguous" : "not-found",
      reminders: matches.map(displayReminder),
    };
  }
  const [cancelled] = await db
    .update(assistantRemindersTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(
      eq(assistantRemindersTable.id, matches[0].id),
      eq(assistantRemindersTable.status, "pending"),
    ))
    .returning();
  return {
    tool: "persistent-reminders",
    action,
    status: cancelled ? "cancelled" : "not-found",
    reminders: cancelled ? [displayReminder(cancelled)] : [],
  };
}

export function buildReminderContext(
  message: string,
  result: ReminderToolResult,
): string {
  const reminders = result.reminders.length > 0
    ? result.reminders
        .map((reminder) =>
          `- Reminder #${reminder.id}: ${reminder.text} — ${reminder.displayTime}`)
        .join("\n")
    : "- No matching pending reminders.";
  return `[User request]
${message}

[Lumen persistent reminder tool — authoritative result]
Action: ${result.action}
Status: ${result.status}
${reminders}

The reminder tool has already completed the action shown above. Report the result naturally. Do not claim a reminder was created or cancelled unless the status confirms it. There are no notifications or autonomous actions; reminders are stored records only.`;
}