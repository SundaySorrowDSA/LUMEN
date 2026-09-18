import { Router, type IRouter } from "express";
import {
  getPushConfiguration,
  removePushSubscription,
  savePushSubscription,
} from "../tools/push-notifications.js";

const router: IRouter = Router();

router.get("/push/config", (_req, res) => {
  res.json(getPushConfiguration());
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