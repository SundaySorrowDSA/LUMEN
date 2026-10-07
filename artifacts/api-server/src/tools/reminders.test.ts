import assert from "node:assert/strict";
import test from "node:test";
import { assistantRemindersTable, db } from "@workspace/db";
import { parseReminderCreation, ReminderValidationError, requiresReminderTool, runReminderTool } from "./reminders.js";

const now = new Date("2026-10-07T17:00:00Z");
for (const content of [
  "Remind me", "Remind me to drink water", "Remind me tomorrow at 9 AM",
  "Remind me at 9 AM to drink water",
  "Remind me today at 6 AM to drink water",
  "Remind me tomorrow at 25 PM to drink water",
  "Remind me tomorrow at 9:99 AM to drink water",
]) {
  test(`incomplete/invalid scheduling request needs clarification: ${content}`, () => {
    assert.equal(requiresReminderTool(content), true);
    assert.throws(() => parseReminderCreation(content, now), ReminderValidationError);
  });
}

test("casual recollections do not create scheduled reminders, even with time words", () => {
  for (const content of [
    "Remind me how we do this", "Remind me what you said",
    "You remind me of home", "You remind me to drink water tomorrow at 9 AM",
    "Can you remind me about our conversation?",
  ]) assert.equal(requiresReminderTool(content), false, content);
});

test("complete future reminders parse without writing anything", () => {
  const parsed = parseReminderCreation("Please remind me tomorrow at 9 AM to drink water", now);
  assert.equal(parsed.text, "drink water");
  assert.ok(parsed.dueAt > now);
  assert.equal(requiresReminderTool("Cancel reminder #2"), true);
  assert.equal(requiresReminderTool("List my reminders"), true);
});

for (const [duration, milliseconds] of [
  ["30 seconds", 30_000],
  ["75 seconds", 75_000],
  ["5 minutes", 300_000],
  ["2 hours", 7_200_000],
  ["3 days", 259_200_000],
  ["1 second", 1_000],
  ["1 minute", 60_000],
  ["1 hour", 3_600_000],
  ["1 day", 86_400_000],
] as const) {
  test(`relative ${duration} resolves to an absolute server timestamp with separate text`, () => {
    const input = `Remind me in ${duration} to test dark mode`;
    assert.equal(requiresReminderTool(input), true);
    const parsed = parseReminderCreation(input, now);
    assert.equal(parsed.text, "test dark mode");
    assert.equal(parsed.dueAt.getTime(), now.getTime() + milliseconds);
  });
}

test("75-second request uses the same captured request clock for validation and creation", () => {
  const requestTime = new Date("2026-10-07T17:00:00.123Z");
  const input = "Remind me in 75 seconds to test dark mode";
  const validated = parseReminderCreation(input, requestTime);
  const creation = parseReminderCreation(input, requestTime);
  assert.equal(creation.dueAt.toISOString(), "2026-10-07T17:01:15.123Z");
  assert.equal(creation.dueAt.getTime(), validated.dueAt.getTime());
  assert.equal(requestTime.toISOString(), "2026-10-07T17:00:00.123Z");
});

test("the existing reminder tool inserts the absolute due time and separate text using the request clock", async t => {
  const requestTime = new Date("2026-10-07T17:00:00.123Z");
  const values: Array<{ text: string; dueAt: Date; status: string }> = [];
  t.mock.method(db, "insert", (table: unknown) => {
    assert.equal(table, assistantRemindersTable);
    return {
      values: (value: { text: string; dueAt: Date; status: string }) => {
        values.push(value);
        return { returning: async () => [{ id: 1, ...value }] };
      },
    } as unknown as ReturnType<typeof db.insert>;
  });
  const result = await runReminderTool("Remind me in 75 seconds to test dark mode", requestTime);
  assert.equal(values.length, 1);
  assert.equal(values[0].text, "test dark mode");
  assert.equal(values[0].status, "pending");
  assert.equal(values[0].dueAt.toISOString(), "2026-10-07T17:01:15.123Z");
  assert.equal(result.status, "created");
  assert.equal(result.reminders[0].dueAt, "2026-10-07T17:01:15.123Z");
});

test("invalid relative requests never reach the database insert", async t => {
  t.mock.method(db, "insert", () => { assert.fail("Invalid reminder attempted a database write"); });
  await assert.rejects(runReminderTool("Remind me in 0 seconds to test dark mode", now), ReminderValidationError);
});

test("without an injected test clock, relative time comes from the current server clock", () => {
  const before = Date.now();
  const parsed = parseReminderCreation("Remind me in 75 seconds to test dark mode");
  const after = Date.now();
  assert.ok(parsed.dueAt.getTime() >= before + 75_000);
  assert.ok(parsed.dueAt.getTime() <= after + 75_000);
});

test("relative parsing preserves punctuation, capitalization and timing words inside the reminder text", () => {
  const parsed = parseReminderCreation(
    "Could you please remind me IN 75 SECONDS to discuss tomorrow at 9 AM.", now,
  );
  assert.equal(parsed.text, "discuss tomorrow at 9 AM");
  assert.equal(parsed.dueAt.toISOString(), "2026-10-07T17:01:15.000Z");
});

for (const duration of [
  "0 seconds", "0 minutes", "-30 seconds", "+30 seconds",
  "1.5 minutes", "seconds", "five minutes", "a few minutes",
  "30 or 75 seconds", "5 to 10 minutes", "1 minute and 30 seconds",
  "75", "75 seconds tomorrow at 9 AM",
  "9007199254740992 seconds", "9007199254740991 days", "1000000000 days",
]) {
  test(`invalid or ambiguous relative duration is a clean validation error: ${duration}`, () => {
    assert.throws(
      () => parseReminderCreation(`Remind me in ${duration} to test dark mode`, now),
      ReminderValidationError,
    );
  });
}

test("relative reminders still require actual reminder text", () => {
  for (const input of [
    "Remind me in 75 seconds",
    "Remind me in 75 seconds to ",
    "Remind me in 75 seconds to .",
  ]) assert.throws(() => parseReminderCreation(input, now), ReminderValidationError);
});

test("a valid relative phrase inside the text cannot rescue a malformed outer duration", () => {
  assert.throws(
    () => parseReminderCreation("Remind me in -30 seconds to say remind me in 75 seconds to test dark mode", now),
    ReminderValidationError,
  );
});

test("relative days are elapsed 24-hour durations, even across daylight saving changes", () => {
  const beforeClockChange = new Date("2026-10-31T16:00:00Z");
  const parsed = parseReminderCreation("Remind me in 3 days to test dark mode", beforeClockChange);
  assert.equal(parsed.dueAt.toISOString(), "2026-11-03T16:00:00.000Z");
});

test("existing absolute reminder syntaxes retain their exact timestamps", () => {
  for (const [input, expected] of [
    ["Remind me tomorrow at 9 AM to drink water.", "2026-10-08T13:00:00.000Z"],
    ["Remind me today at 2 PM to drink water.", "2026-10-07T18:00:00.000Z"],
    ["Remind me on Thursday at 9 AM to drink water.", "2026-10-08T13:00:00.000Z"],
    ["Remind me October 15, 2026 at 9 AM to drink water.", "2026-10-15T13:00:00.000Z"],
  ]) {
    const parsed = parseReminderCreation(input, now);
    assert.equal(parsed.text, "drink water");
    assert.equal(parsed.dueAt.toISOString(), expected);
  }
});
