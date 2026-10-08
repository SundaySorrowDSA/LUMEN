import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { deliverDueReminderNotifications } from "../tools/push-notifications.js";
import { logger } from "../lib/logger.js";

type DeliveryResult = Awaited<ReturnType<typeof deliverDueReminderNotifications>>;
type Dependencies = {
  token: () => string | undefined;
  deliver: () => Promise<DeliveryResult>;
  log: (fields: Record<string, unknown>) => void;
};

export function createReminderWorkerHandler(deps: Dependencies): RequestHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const suppliedRunId = req.get("x-lumen-scheduler-run-id") ?? "";
    const runId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedRunId)
      ? suppliedRunId : randomUUID();
    const reject = (status: number, code: string) => {
      deps.log({ component: "reminder-worker-endpoint", stage: "worker_request_rejected", runId, code });
      res.status(status).json({ ok: false, runId, code });
    };
    // Never accept credentials in URLs, or let diagnostic traffic perform writes.
    if (req.originalUrl.includes("?")) { reject(400, "query_not_allowed"); return; }
    const expected = deps.token()?.trim();
    if (!expected || expected.length < 32 || /[\s,]/.test(expected)) {
      reject(503, "worker_token_not_configured");
      return;
    }
    const header = req.get("x-lumen-worker-authorization") ?? req.get("authorization") ?? "";
    const provided = /^Bearer[ \t]+([^\s,]+)$/i.exec(header)?.[1];
    // Fixed-length digest comparison does not reveal the expected token length.
    if (!provided || !timingSafeEqual(
      createHash("sha256").update(provided).digest(),
      createHash("sha256").update(expected).digest(),
    )) {
      reject(401, "worker_unauthorized");
      return;
    }
    if (req.get("x-lumen-test-mode") === "isolated") {
      reject(403, "isolated_worker_execution_forbidden");
      return;
    }
    const source = req.get("x-lumen-scheduler-source") === "replit-scheduled-deployment"
      ? "scheduler-caller" : "manual-or-unknown";
    // Source is a caller assertion, NOT proof that a platform schedule is active.
    deps.log({ component: "reminder-worker-endpoint", stage: "worker_request_authorized", runId, source });
    const started = Date.now();
    try {
      // No caller-supplied time, reminder IDs, privacy options, or delivery flags.
      const delivery = await deps.deliver();
      const result = {
        reminders: delivery.reminders, subscriptions: delivery.subscriptions,
        delivered: delivery.delivered, chatDelivered: delivery.chatDelivered,
        failed: delivery.failed, expired: delivery.expired, suppressed: delivery.suppressed,
      };
      if (typeof result.suppressed !== "boolean" ||
          [result.reminders, result.subscriptions, result.delivered, result.chatDelivered, result.failed, result.expired]
            .some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("invalid_worker_result");
      const ok = result.failed === 0;
      deps.log({
        component: "reminder-worker-endpoint",
        stage: ok ? "worker_request_completed" : "worker_request_failed",
        runId, source, durationMs: Date.now() - started, ...result,
      });
      res.status(ok ? 200 : 502).json({
        ok, runId, result, ...(ok ? {} : { code: "worker_partial_failure" }),
      });
    } catch {
      // Neither exception text nor request headers/body belong in these logs.
      deps.log({
        component: "reminder-worker-endpoint", stage: "worker_request_failed",
        runId, source, durationMs: Date.now() - started, code: "worker_exception",
      });
      res.status(502).json({ ok: false, runId, code: "worker_exception" });
    }
  };
}

const router = Router();
router.post("/internal/reminders/run-due", createReminderWorkerHandler({
  token: () => process.env.LUMEN_REMINDER_WORKER_TOKEN,
  deliver: deliverDueReminderNotifications,
  log: fields => logger.info(fields, "Reminder worker endpoint"),
}));
export default router;
