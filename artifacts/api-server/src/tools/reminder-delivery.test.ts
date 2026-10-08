import assert from "node:assert/strict";
import test from "node:test";
import { db } from "@workspace/db";
import { claimReminderQuery } from "./push-notifications.js";
import {
  deliverReminder, findOriginFromCreationMetadata, pushFailureCode,
  type DeliveryReminder, type ReminderDeliveryPort,
} from "./reminder-delivery.js";

const due = new Date("2026-10-08T01:03:39.278Z");
function fixture() {
  const reminder: DeliveryReminder = {
    id: 2, text: "check the oven", dueAt: due, conversationId: 7,
    status: "pending", chatStatus: "pending", chatDeliveredAt: null,
    pushStatus: "pending", pushAttemptedAt: null, pushLastError: null, notificationSentAt: null,
  };
  const chats: Array<{ conversationId: number; content: string }> = [];
  const accepted = new Set<number>();
  const sends: number[] = [];
  const removed: number[] = [];
  const events: string[] = [];
  let clock = new Date(due.getTime() + 30_000);
  const errors = new Map<number, unknown>();
  const port: ReminderDeliveryPort = {
    clock: () => clock,
    log: (stage, fields = {}) => events.push(JSON.stringify({ stage, ...fields })),
    save: async patch => { Object.assign(reminder, patch); },
    findOrigin: async () => 7,
    insertChat: async (conversationId, content) => { chats.push({ conversationId, content }); },
    acceptedSubscriptions: async () => [...accepted],
    send: async id => { sends.push(id); if (errors.has(id)) throw errors.get(id); },
    recordAcceptance: async id => { accepted.add(id); },
    removeInvalidSubscription: async id => { removed.push(id); },
  };
  const options = { subscriptionIds: [5], pushConfigured: true, darkMode: false };
  return { reminder, chats, accepted, sends, removed, events, errors, port, options, setClock: (at: Date) => { clock = at; } };
}

test("due delivery creates a readable message in the originating conversation and records accepted push separately", async () => {
  const f = fixture();
  const result = await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(result.chatDelivered, 1);
  assert.equal(result.delivered, 1);
  assert.equal(f.chats[0].conversationId, 7);
  assert.match(f.chats[0].content, /Reminder: check the oven/);
  assert.ok(f.reminder.chatDeliveredAt);
  assert.ok(f.reminder.notificationSentAt);
  assert.equal(f.reminder.pushStatus, "delivered");
  assert.equal(f.reminder.status, "completed");
});

test("push failure commits chat delivery but never a false push sent timestamp", async () => {
  const f = fixture();
  f.errors.set(5, { statusCode: 503, message: "secret endpoint token" });
  await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(f.chats.length, 1);
  assert.equal(f.reminder.chatStatus, "delivered");
  assert.equal(f.reminder.notificationSentAt, null);
  assert.equal(f.reminder.pushStatus, "failed");
  assert.equal(f.reminder.pushLastError, "http_503");
  assert.ok(f.reminder.pushAttemptedAt);
  assert.ok(f.events.some(value => value.includes("push_failed")));
  assert.ok(!f.events.join("").includes("secret endpoint token"));
});

test("retry after push failure sends again without duplicating the chat message", async () => {
  const f = fixture();
  f.errors.set(5, { statusCode: 503 });
  await deliverReminder(f.reminder, f.port, f.options);
  f.errors.clear();
  await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(f.chats.length, 1);
  assert.deepEqual(f.sends, [5, 5]);
  assert.equal(f.reminder.pushStatus, "delivered");
  await deliverReminder(f.reminder, f.port, f.options);
  assert.deepEqual(f.sends, [5, 5]);
  assert.equal(f.chats.length, 1);
});

test("partial retries skip successful subscriptions and retry only failed subscriptions", async () => {
  const f = fixture();
  f.options.subscriptionIds = [4, 5];
  f.errors.set(5, { statusCode: 500 });
  await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(f.reminder.pushStatus, "partial");
  assert.deepEqual([...f.accepted], [4]);
  f.errors.clear();
  await deliverReminder(f.reminder, f.port, f.options);
  assert.deepEqual(f.sends, [4, 5, 5]);
  assert.equal(f.chats.length, 1);
  assert.equal(f.reminder.pushStatus, "delivered");
});

test("outside the push window still delivers overdue chat, expires push, and never sets sent time", async () => {
  const f = fixture();
  f.setClock(new Date(due.getTime() + 180_001));
  await deliverReminder(f.reminder, f.port, f.options);
  assert.match(f.chats[0].content, /Overdue reminder: check the oven/);
  assert.equal(f.reminder.pushStatus, "expired");
  assert.equal(f.reminder.notificationSentAt, null);
  assert.equal(f.reminder.pushAttemptedAt, null);
  assert.deepEqual(f.sends, []);
  assert.equal(f.reminder.status, "completed");
});

test("freshness boundary permits exactly three minutes but rechecks before each send", async () => {
  const f = fixture();
  f.setClock(new Date(due.getTime() + 180_000));
  await deliverReminder(f.reminder, f.port, f.options);
  assert.deepEqual(f.sends, [5]);
  const slow = fixture();
  slow.options.subscriptionIds = [4, 5];
  slow.port.send = async id => {
    slow.sends.push(id);
    slow.setClock(new Date(due.getTime() + 180_001));
  };
  await deliverReminder(slow.reminder, slow.port, slow.options);
  assert.deepEqual(slow.sends, [4]);
  assert.equal(slow.reminder.pushStatus, "expired");
  assert.ok(slow.reminder.notificationSentAt); // One actual accepted send, not the expired second send.
});

test("Dark Mode suppresses external pushes while chat is persisted; All Clear retries once", async () => {
  const f = fixture();
  f.options.darkMode = true;
  await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(f.chats.length, 1);
  assert.deepEqual(f.sends, []);
  assert.equal(f.reminder.pushStatus, "pending");
  f.options.darkMode = false;
  await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(f.chats.length, 1);
  assert.deepEqual(f.sends, [5]);
});

test("no subscription or missing VAPID configuration does not block chat or fake push success", async () => {
  for (const reason of ["no_subscriptions", "push_not_configured"]) {
    const f = fixture();
    if (reason === "no_subscriptions") f.options.subscriptionIds = [];
    else f.options.pushConfigured = false;
    await deliverReminder(f.reminder, f.port, f.options);
    assert.equal(f.chats.length, 1);
    assert.equal(f.reminder.pushLastError, reason);
    assert.equal(f.reminder.notificationSentAt, null);
  }
});

test("410 removes invalid subscription, but never records an accepted send", async () => {
  const f = fixture();
  f.errors.set(5, { statusCode: 410 });
  await deliverReminder(f.reminder, f.port, f.options);
  assert.deepEqual(f.removed, [5]);
  assert.equal(f.accepted.size, 0);
  assert.equal(f.reminder.notificationSentAt, null);
});

test("chat insert failure cannot mark chat delivered", async () => {
  const f = fixture();
  f.port.insertChat = async () => { throw new Error("database failure"); };
  await assert.rejects(deliverReminder(f.reminder, f.port, f.options), /chat_transaction_failed/);
  assert.equal(f.reminder.chatDeliveredAt, null);
  assert.equal(f.reminder.chatStatus, "pending");
  assert.ok(f.events.some(value => value.includes("chat_failed")));
});

test("unlinked legacy reminders are not delivered to an arbitrary conversation", async () => {
  const f = fixture();
  f.reminder.conversationId = null;
  f.port.findOrigin = async () => null;
  await deliverReminder(f.reminder, f.port, f.options);
  assert.equal(f.reminder.chatStatus, "unlinked");
  assert.equal(f.reminder.chatDeliveredAt, null);
  assert.equal(f.chats.length, 0);
  assert.deepEqual(f.sends, [5]);
});

test("legacy origin recovery requires unique verified creation evidence", () => {
  const metadata = JSON.stringify({ tools: [{ id: "persistent-reminders", action: "create", status: "created", reminderIds: [2] }] });
  assert.equal(findOriginFromCreationMetadata(2, [{ conversationId: 7, metadata }]), 7);
  assert.equal(findOriginFromCreationMetadata(2, [{ conversationId: 7, metadata }, { conversationId: 8, metadata }]), null);
  assert.equal(findOriginFromCreationMetadata(3, [{ conversationId: 7, metadata }]), null);
  assert.equal(findOriginFromCreationMetadata(2, [{ conversationId: 7, metadata: "broken" }]), null);
});

test("transport errors expose only sanitized codes", () => {
  assert.deepEqual(pushFailureCode(new Error("https://secret-endpoint/token")), { code: "transport_error", status: 0 });
});

test("actual worker SQL locks only a pending due reminder and skips overlapping workers without executing SQL", () => {
  const query = claimReminderQuery(db, 2, due).toSQL();
  assert.match(query.sql, /for update skip locked/i);
  assert.match(query.sql, /"status" =/);
  assert.match(query.sql, /"due_at" <=/);
  assert.ok(query.params.includes(2));
  assert.ok(query.params.includes("pending"));
});
