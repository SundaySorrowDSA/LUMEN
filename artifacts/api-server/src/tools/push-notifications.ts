import webpush from "web-push";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  assistantPushSubscriptionsTable,
  assistantRemindersTable,
  db,
} from "@workspace/db";

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
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

  let delivered = 0;
  for (const reminder of reminders) {
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
  return { reminders: reminders.length, subscriptions: subscriptions.length, delivered };
}