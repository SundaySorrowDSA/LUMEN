import assert from "node:assert/strict";
import test from "node:test";
import {
  assertManagedActionAcknowledgement,
  buildVerifiedReminderReply,
  completeGroundedReply,
  hasReminderCreationEvidence,
  managedActionGroundingContext,
  UnverifiedManagedActionError,
} from "./reminder-action-policy.js";
import type { ReminderToolResult } from "./reminders.js";

const created: ReminderToolResult = {
  tool: "persistent-reminders", action: "create", status: "created",
  reminders: [{ id: 42, text: "check the oven", dueAt: "2026-10-07T17:01:15.000Z", displayTime: "Wednesday, October 7, 1:01 PM EDT" }],
};

test("a successful reminder reply is generated from the saved tool record, not Kindroid", () => {
  const reply = buildVerifiedReminderReply(created);
  assert.equal(reply.providerId, "lumen-reminder-tool");
  assert.equal(reply.metadata.mode, "tool");
  assert.ok(reply.content.includes("check the oven"));
  assert.ok(reply.content.includes(created.reminders[0].dueAt));
  assert.ok(!reply.content.includes("I'll remind you"));
  assert.doesNotThrow(() => assertManagedActionAcknowledgement(reply.content, created));
});

test("no tool, empty results, wrong actions, or invalid record IDs cannot create acknowledgements", () => {
  for (const result of [
    null,
    { ...created, reminders: [] },
    { ...created, status: "not-found" as const },
    { ...created, reminders: [{ ...created.reminders[0], id: 0 }] },
    { ...created, reminders: [{ ...created.reminders[0], dueAt: "invalid" }] },
    { ...created, action: "list" as const },
  ]) {
    assert.equal(hasReminderCreationEvidence(result), false);
    assert.throws(() => buildVerifiedReminderReply(result), UnverifiedManagedActionError);
  }
});

for (const content of [
  '"Timer set. 75 seconds on the clock," I confirm.',
  "Reminder set.",
  "I'll remind you in 75 seconds.",
  "75 seconds on the clock.",
  "I've scheduled your timer.",
  "Your notification was sent.",
  "I've created your scheduled action.",
]) {
  test(`Kindroid-only unsupported acknowledgement is rejected, not rewritten: ${content}`, () => {
    assert.throws(() => assertManagedActionAcknowledgement(content, null), UnverifiedManagedActionError);
  });
}

test("reminder creation evidence does not verify a notification or promise of later delivery", () => {
  assert.throws(() => assertManagedActionAcknowledgement("I'll notify you when it's due.", created), UnverifiedManagedActionError);
  assert.throws(() => assertManagedActionAcknowledgement("Notification sent.", created), UnverifiedManagedActionError);
});

test("normal conversation, immediate recollection and honest non-completion remain ordinary replies", () => {
  for (const content of [
    "Ren is here to talk with you.",
    "No reminder was set.",
    "I haven't created a timer.",
    "I'll remind you how the oven works.",
  ]) assert.doesNotThrow(() => assertManagedActionAcknowledgement(content, null));
});

test("ordinary provider requests carry explicit no-action grounding rather than invented success", () => {
  const context = managedActionGroundingContext("Ren, can we talk?");
  assert.ok(context.startsWith("Ren, can we talk?"));
  assert.ok(context.includes("No reminder, timer, alarm, scheduled action, or notification was created"));
  assert.ok(context.includes("Do not say these actions succeeded"));
});

test("list and cancel tool results cannot be mistaken for new reminder creation", () => {
  assert.ok(buildVerifiedReminderReply({ ...created, action: "list", status: "listed" }).content.includes("Reminder #42"));
  assert.ok(buildVerifiedReminderReply({ ...created, action: "cancel", status: "cancelled" }).content.startsWith("Cancelled"));
  assert.equal(hasReminderCreationEvidence({ ...created, action: "cancel", status: "cancelled" }), false);
});

test("the chat boundary never calls Kindroid to acknowledge a routed reminder", async () => {
  let providerCalls = 0;
  const reply = await completeGroundedReply(true, created, async () => {
    providerCalls++;
    return { content: "Timer set. 75 seconds on the clock." };
  });
  assert.equal(providerCalls, 0);
  assert.equal(reply.content, buildVerifiedReminderReply(created).content);
});

test("a detected reminder without tool success cannot fall back to Kindroid-only timer claims", async () => {
  let providerCalls = 0;
  const kindroidOnly = async () => {
    providerCalls++;
    return { content: "Timer set. 75 seconds on the clock." };
  };
  await assert.rejects(completeGroundedReply(true, null, kindroidOnly), UnverifiedManagedActionError);
  await assert.rejects(completeGroundedReply(true, { ...created, status: "not-found" }, kindroidOnly), UnverifiedManagedActionError);
  assert.equal(providerCalls, 0);
});

test("unsupported claims from an ordinary Kindroid reply are not returned as successful chat", async () => {
  await assert.rejects(
    completeGroundedReply(false, null, async () => ({ content: "Reminder set. I'll remind you." })),
    UnverifiedManagedActionError,
  );
});

test("user task quotations in a verified record are not rewritten or mistaken for provider promises", async () => {
  const result = { ...created, reminders: [{ ...created.reminders[0], text: 'say "I will remind you"' }] };
  const reply = await completeGroundedReply(true, result, async () => { assert.fail("Provider must not be called"); });
  assert.ok(reply.content.includes('say "I will remind you"'));
});
