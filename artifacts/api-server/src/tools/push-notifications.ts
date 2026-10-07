import webpush from "web-push";
import { and, eq, isNull, lt, lte } from "drizzle-orm";
import {
  assistantPushSubscriptionsTable,
  assistantRemindersTable,
  db,
} from "@workspace/db";
import { getPrivacyMode } from "./privacy-mode.js";
import { isReminderFreshEnough, REMINDER_NOTIFICATION_GRACE_MS } from "./reminder-notification-policy.js";

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.replace(/\s+/g, "");
  const privateKey = process.env.VAPID_PRIVATE_KEY?.replace(/\s+/g, "");
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey };
  } catch {
    return null;
  }
}

export function getPushConfiguration() {
  const configuration = configureWebPush();
  return configuration
    ? { configured: true as const, publicKey: configuration.publicKey }
    : { configured: false as const, publicKey: null };
}

export async function savePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS");
  const [saved] = await db
    .insert(assistantPushSubscriptionsTable)
    .values({
      endpoint: endpoint.toString(),
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: assistantPushSubscriptionsTable.endpoint,
      set: {
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        updatedAt: new Date(),
      },
    })
    .returning({ id: assistantPushSubscriptionsTable.id });
  return saved;
}

export async function removePushSubscription(endpointValue: string) {
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS");
  await db
    .delete(assistantPushSubscriptionsTable)
    .where(eq(assistantPushSubscriptionsTable.endpoint, endpoint.toString()));
}

export async function deliverDueReminderNotifications(now = new Date()) {
  if (!configureWebPush()) throw new Error("Web push is not configured");
  const privacy = await getPrivacyMode();
  if (privacy.darkMode) {
    return { reminders: 0, subscriptions: 0, delivered: 0, suppressed: true };
  }

  const [subscriptions, reminders] = await Promise.all([
    db.select().from(assistantPushSubscriptionsTable),
    db
      .select()
      .from(assistantRemindersTable)
      .where(and(
        eq(assistantRemindersTable.status, "pending"),
        isNull(assistantRemindersTable.notificationSentAt),
        lte(assistantRemindersTable.dueAt, now),
      )),
  ]);

  const freshReminders = reminders.filter((reminder) => isReminderFreshEnough(reminder.dueAt, now));
  const staleReminderIds = reminders
    .filter((reminder) => !isReminderFreshEnough(reminder.dueAt, now))
    .map((reminder) => reminder.id);
  if (staleReminderIds.length > 0) {
    await db
      .update(assistantRemindersTable)
      .set({ notificationSentAt: now })
      .where(and(
        eq(assistantRemindersTable.status, "pending"),
        isNull(assistantRemindersTable.notificationSentAt),
        lt(assistantRemindersTable.dueAt, new Date(now.getTime() - REMINDER_NOTIFICATION_GRACE_MS)),
      ));
  }

  let delivered = 0;
  for (const reminder of freshReminders) {
    let sentForReminder = false;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: "Lumen reminder",
            body: reminder.text,
            reminderId: reminder.id,
            dueAt: reminder.dueAt.toISOString(),
          }),
          { TTL: 3600, urgency: "high" },
        );
        delivered += 1;
        sentForReminder = true;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await db
            .delete(assistantPushSubscriptionsTable)
            .where(eq(assistantPushSubscriptionsTable.id, subscription.id));
        }
      }
    }
    if (sentForReminder) {
      await db
        .update(assistantRemindersTable)
        .set({ notificationSentAt: now })
        .where(eq(assistantRemindersTable.id, reminder.id));
    }
  }
  return { reminders: freshReminders.length, subscriptions: subscriptions.length, delivered, suppressed: false };
}