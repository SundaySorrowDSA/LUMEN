import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createReminderWorkerHandler } from "./reminder-worker.js";

// Synthetic fixtures only. This value is NOT a project credential.
const token = "unit-fixture-not-a-real-credential-0123456789";
const runId = "923af02c-d919-4143-961b-f3f007aba647";
const result = { reminders: 1, subscriptions: 1, delivered: 1, chatDelivered: 1, failed: 0, expired: 0, suppressed: false };

async function invoke(options: {
  headers?: Record<string, string>; configuredToken?: string | null;
  url?: string; partial?: boolean; throws?: boolean; extraResult?: Record<string, unknown>;
} = {}) {
  let calls = 0;
  let status = 200;
  let body: Record<string, unknown> = {};
  const events: Array<Record<string, unknown>> = [];
  const headers = options.headers ?? {};
  const handler = createReminderWorkerHandler({
    token: () => options.configuredToken === null ? undefined : options.configuredToken ?? token,
    deliver: async (...args) => {
      calls++;
      assert.equal(args.length, 0, "caller must not control worker time or flags");
      if (options.throws) throw new Error(`exception with sensitive ${token}`);
      return { ...result, failed: options.partial ? 1 : 0, ...options.extraResult };
    },
    log: fields => events.push(fields),
  });
  const req = {
    get: (name: string) => headers[name.toLowerCase()],
    originalUrl: options.url ?? "/api/internal/reminders/run-due",
  } as unknown as Request;
  const res = {
    setHeader: () => {},
    status: (value: number) => { status = value; return res; },
    json: (value: Record<string, unknown>) => { body = value; return res; },
  } as unknown as Response;
  // No HTTP calls, real worker execution, environment mutation, or DB writes.
  await handler(req, res, () => {});
  assert.ok(!JSON.stringify(events).includes(token));
  assert.ok(!JSON.stringify(body).includes(token));
  return { calls, status, body, events };
}

test("missing and incorrect tokens are rejected before worker invocation", async () => {
  for (const authorization of [undefined, "Bearer wrong", "Basic anything", `Bearer ${token},wrong`]) {
    const actual = await invoke({ headers: authorization ? { authorization } : {} });
    assert.equal(actual.status, 401);
    assert.equal(actual.calls, 0);
  }
});

test("missing or weak configured secret fails closed", async () => {
  for (const configuredToken of [null, "", "short", "bad whitespace ".repeat(4)]) {
    const actual = await invoke({ configuredToken, headers: { authorization: `Bearer ${token}` } });
    assert.equal(actual.status, 503);
    assert.equal(actual.calls, 0);
  }
});

test("valid bearer invokes existing worker once with no caller options", async () => {
  const actual = await invoke({ headers: {
    authorization: `Bearer ${token}`,
    "x-lumen-scheduler-run-id": runId,
    "x-lumen-scheduler-source": "replit-scheduled-deployment",
  } });
  assert.equal(actual.calls, 1);
  assert.equal(actual.status, 200);
  assert.deepEqual(actual.body, { ok: true, runId, result });
  assert.ok(actual.events.some(event => event.stage === "worker_request_completed" && event.runId === runId));
});

test("dedicated bearer forwarding header works when gateway removes Authorization", async () => {
  const actual = await invoke({ headers: { "x-lumen-worker-authorization": `Bearer ${token}` } });
  assert.equal(actual.status, 200);
  assert.equal(actual.calls, 1);
});

test("invalid forwarding header cannot be bypassed by a valid fallback Authorization", async () => {
  const actual = await invoke({ headers: {
    "x-lumen-worker-authorization": "Bearer incorrect",
    authorization: `Bearer ${token}`,
  } });
  assert.equal(actual.status, 401);
  assert.equal(actual.calls, 0);
});

test("query credentials and isolated diagnostic writes cannot execute worker", async () => {
  const query = await invoke({ url: `/api/internal/reminders/run-due?token=${token}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(query.status, 400);
  assert.equal(query.calls, 0);
  const isolated = await invoke({ headers: { authorization: `Bearer ${token}`, "x-lumen-test-mode": "isolated" } });
  assert.equal(isolated.status, 403);
  assert.equal(isolated.calls, 0);
});

test("worker exception produces sanitized failure without claiming success", async () => {
  const actual = await invoke({ throws: true, headers: { authorization: `Bearer ${token}` } });
  assert.equal(actual.calls, 1);
  assert.equal(actual.status, 502);
  assert.equal(actual.body.ok, false);
  assert.equal(actual.body.code, "worker_exception");
  assert.ok(actual.events.some(event => event.stage === "worker_request_failed"));
});

test("partial failure is an HTTP failure even when chat or some pushes succeeded", async () => {
  const actual = await invoke({ partial: true, headers: { authorization: `Bearer ${token}` } });
  assert.equal(actual.status, 502);
  assert.equal(actual.body.ok, false);
  assert.equal(actual.body.code, "worker_partial_failure");
});

test("log identifiers and result metrics cannot smuggle unexpected sensitive fields", async () => {
  const actual = await invoke({
    headers: { authorization: `Bearer ${token}`, "x-lumen-scheduler-run-id": `invalid ${token}` },
    extraResult: { unexpectedSecret: token },
  });
  assert.equal(actual.status, 200);
  assert.notEqual(actual.body.runId, `invalid ${token}`);
  assert.deepEqual(actual.body.result, result);
});
