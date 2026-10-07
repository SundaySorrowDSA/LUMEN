import test from "node:test";
import assert from "node:assert/strict";
import { isReminderFreshEnough, REMINDER_NOTIFICATION_GRACE_MS } from "./reminder-notification-policy.js";

test("All Clear accepts reminders within the three-minute window", () => {
  const now = new Date("2026-10-07T17:00:00.000Z");
  assert.equal(isReminderFreshEnough(new Date(now.getTime()), now), true);
  assert.equal(isReminderFreshEnough(new Date(now.getTime() - REMINDER_NOTIFICATION_GRACE_MS), now), true);
  assert.equal(isReminderFreshEnough(new Date(now.getTime() - REMINDER_NOTIFICATION_GRACE_MS - 1), now), false);
});
