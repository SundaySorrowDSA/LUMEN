import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const countFields = ["reminders", "subscriptions", "delivered", "chatDelivered", "failed", "expired"];

// Standalone Node 22+ caller: no npm packages, database credentials, or VAPID keys.
export async function callReminderWorker(
  { productionUrl, token },
  { fetchImpl = fetch, log = fields => console.log(JSON.stringify(fields)), runId = randomUUID() } = {},
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) runId = randomUUID();
  const emit = (stage, fields = {}) => log({ component: "lumen-scheduler-caller", stage, runId, ...fields });
  const fail = (code, fields = {}) => { emit("scheduled_call_failed", { code, ...fields }); return 1; };
  if (!productionUrl) return fail("missing_production_url");
  let base;
  try { base = new URL(productionUrl); } catch { return fail("invalid_production_url"); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
      base.pathname !== "/" || /(^|\.)replit\.dev$/i.test(base.hostname) ||
      ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) return fail("invalid_production_url");
  const secret = token?.trim();
  if (!secret || secret.length < 32 || /[\s,]/.test(secret)) return fail("invalid_worker_token");
  const url = new URL("/api/internal/reminders/run-due", base);
  emit("scheduled_call_started");
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "manual", // Never forward credentials through login redirects.
      headers: {
        Authorization: `Bearer ${secret}`,
        "X-Lumen-Worker-Authorization": `Bearer ${secret}`,
        "X-Lumen-Scheduler-Run-Id": runId,
        "X-Lumen-Scheduler-Source": "replit-scheduled-deployment",
      },
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) return fail("http_failure", { httpStatus: response.status });
    let body;
    try { body = await response.json(); } catch { return fail("invalid_worker_response"); }
    if (body?.ok !== true || body.runId !== runId || typeof body.result?.suppressed !== "boolean" ||
        !countFields.every(field => Number.isSafeInteger(body.result?.[field]) && body.result[field] >= 0)) {
      return fail("invalid_worker_response");
    }
    // Whitelist metrics: never echo an unexpected server field into logs.
    const result = Object.fromEntries(countFields.map(field => [field, body.result[field]]));
    result.suppressed = body.result.suppressed;
    if (result.failed !== 0) return fail("worker_reported_failure");
    emit("scheduled_call_completed", { httpStatus: response.status, result });
    return 0;
  } catch {
    // Fetch errors may contain URLs, headers, or credentials. Do not print them.
    return fail("network_or_timeout_failure");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await callReminderWorker({
    productionUrl: process.env.LUMEN_PRODUCTION_URL,
    token: process.env.LUMEN_REMINDER_WORKER_TOKEN,
  });
}
