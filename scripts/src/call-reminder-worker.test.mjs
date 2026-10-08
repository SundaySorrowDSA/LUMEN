import assert from "node:assert/strict";
import test from "node:test";
import { callReminderWorker } from "./call-reminder-worker.mjs";

const token = "unit-fixture-not-a-real-credential-0123456789";
const runId = "923af02c-d919-4143-961b-f3f007aba647";
const result = { reminders: 0, subscriptions: 0, delivered: 0, chatDelivered: 0, failed: 0, expired: 0, suppressed: false };

async function invoke(config = {}, response = {}, throws = false) {
  const logs = [];
  const requests = [];
  const code = await callReminderWorker({
    productionUrl: "https://lumen-unit-fixture.replit.app", token, ...config,
  }, {
    runId, log: event => logs.push(event),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (throws) throw new Error(`network error with secret ${token}`);
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, runId, result, ...response.body }),
        ...response,
      };
    },
  });
  assert.ok(!JSON.stringify(logs).includes(token));
  return { code, logs, requests };
}

test("caller sends POST, dedicated bearer headers and run correlation without tokens in URLs", async () => {
  const actual = await invoke();
  assert.equal(actual.code, 0);
  assert.equal(actual.requests.length, 1);
  const { url, options } = actual.requests[0];
  assert.equal(url.pathname, "/api/internal/reminders/run-due");
  assert.equal(url.search, "");
  assert.ok(!url.toString().includes(token));
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "manual");
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers["X-Lumen-Worker-Authorization"], `Bearer ${token}`);
  assert.equal(options.headers["X-Lumen-Scheduler-Run-Id"], runId);
  assert.ok(options.signal);
  assert.ok(actual.logs.some(event => event.stage === "scheduled_call_completed"));
});

test("missing config, workspace origin, non-HTTPS and query tokens are rejected before HTTP", async () => {
  for (const config of [
    { token: undefined }, { token: "short" }, { productionUrl: undefined },
    { productionUrl: "https://lumen.replit.dev" },
    { productionUrl: "http://example.com" },
    { productionUrl: `https://example.com?token=${token}` },
    { productionUrl: `https://user:${token}@example.com` },
  ]) {
    const actual = await invoke(config);
    assert.equal(actual.code, 1);
    assert.equal(actual.requests.length, 0);
  }
});

test("auth errors, gateway redirects, worker failure and timeouts produce nonzero exit status", async () => {
  for (const status of [401, 403, 302, 502, 503]) {
    const actual = await invoke({}, { ok: false, status });
    assert.equal(actual.code, 1);
    assert.ok(!actual.logs.some(event => event.stage === "scheduled_call_completed"));
  }
  const timeout = await invoke({}, {}, true);
  assert.equal(timeout.code, 1);
});

test("unexpected HTML, invalid JSON, run mismatch and false success bodies are not accepted", async () => {
  for (const response of [
    { json: async () => { throw new Error("HTML login page"); } },
    { body: { ok: false } },
    { body: { runId: "wrong" } },
    { body: { result: {} } },
    { body: { result: { ...result, failed: 1 } } },
  ]) assert.equal((await invoke({}, response)).code, 1);
});

test("caller logs only whitelisted metrics, never unexpected response secrets", async () => {
  const actual = await invoke({}, { body: { result: { ...result, extraSecret: token } } });
  assert.equal(actual.code, 0);
  assert.deepEqual(actual.logs.find(event => event.stage === "scheduled_call_completed").result, result);
});

test("malformed correlation input is replaced rather than printed in headers or logs", async () => {
  const logs = [];
  const code = await callReminderWorker({
    productionUrl: "https://lumen-unit-fixture.replit.app", token,
  }, {
    runId: token, log: fields => logs.push(fields),
    fetchImpl: async (_url, options) => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, runId: options.headers["X-Lumen-Scheduler-Run-Id"], result }),
    }),
  });
  assert.equal(code, 0);
  assert.ok(!JSON.stringify(logs).includes(token));
});
