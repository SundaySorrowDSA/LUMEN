import { deliverDueReminderNotifications } from "../tools/push-notifications.js";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

deliverDueReminderNotifications()
  .then((result) => {
    logger.info({ component: "reminder-worker", stage: "job_result", ...result }, "Reminder job completed");
    process.exitCode = result.failed ? 1 : 0;
  })
  .catch(() => {
    // Error messages may contain connection strings or endpoint tokens.
    logger.error({ component: "reminder-worker", stage: "worker_failed", reason: "startup_or_database_error" }, "Reminder job failed");
    process.exitCode = 1;
  })
  .finally(async () => { await pool.end(); logger.flush(); });