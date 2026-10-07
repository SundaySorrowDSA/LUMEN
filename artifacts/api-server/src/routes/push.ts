import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";
import {
  deliverDueReminderNotifications,
  getPushConfiguration,
  removePushSubscription,
  savePushSubscription,
} from "../tools/push-notifications.js";
import { getPrivacyMode, setPrivacyMode } from "../tools/privacy-mode.js";

const router: IRouter = Router();

router.get("/push/config", (_req, res) => {
  res.json(getPushConfiguration());
});

router.get("/push/privacy", async (_req, res) => {
  const settings = await getPrivacyMode();
  res.setHeader("Cache-Control", "no-store");
  res.json({ darkMode: settings.darkMode, activatedAt: settings.activatedAt });
});

router.put("/push/privacy", async (req, res) => {
  const darkMode = req.body?.darkMode;
  if (typeof darkMode !== "boolean") {
    res.status(400).json({ error: "darkMode must be a boolean" });
    return;
  }

  const { settings, changed } = await setPrivacyMode(darkMode);
  let released = 0;
  let releasePending = false;
  if (changed && !darkMode) {
    try {
      const result = await deliverDueReminderNotifications();
      released = result.delivered;
    } catch {
      // The scheduled reminder job will retry fresh reminders after All Clear.
      releasePending = true;
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ darkMode: settings.darkMode, activatedAt: settings.activatedAt, changed, released, releasePending });
});

const diagnosticStages = new Set([
  "service-worker-registration",
  "service-worker-ready",
  "existing-subscription",
  "permission",
  "configuration",
  "public-key-decoding",
  "push-subscription",
  "subscription-save",
  "subscription-remove",
]);

router.post("/push/diagnostics", (req, res) => {
  const stage = req.body?.stage;
  const errorName = req.body?.errorName;
  const message = req.body?.message;
  if (
    typeof stage !== "string" ||
    !diagnosticStages.has(stage) ||
    typeof errorName !== "string" ||
    errorName.length > 80 ||
    typeof message !== "string" ||
    message.length > 500
  ) {
    res.status(400).json({ error: "Invalid push diagnostic" });
    return;
  }
  logger.warn({ stage, errorName, message }, "Client push subscription failed");
  res.status(204).send();
});

router.post("/push/subscriptions", async (req, res) => {
  const endpoint = req.body?.endpoint;
  const p256dh = req.body?.keys?.p256dh;
  const auth = req.body?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    endpoint.length > 4096 ||
    p256dh.length > 512 ||
    auth.length > 512
  ) {
    res.status(400).json({ error: "Invalid push subscription" });
    return;
  }
  const saved = await savePushSubscription({ endpoint, keys: { p256dh, auth } });
  res.status(201).json({ subscribed: true, id: saved.id });
});

router.delete("/push/subscriptions", async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 4096) {
    res.status(400).json({ error: "Invalid push subscription" });
    return;
  }
  await removePushSubscription(endpoint);
  res.status(204).send();
});

export default router;