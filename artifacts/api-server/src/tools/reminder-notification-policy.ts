export const REMINDER_NOTIFICATION_GRACE_MS = 3 * 60 * 1000;

export function isReminderFreshEnough(dueAt: Date, now: Date) {
  return dueAt.getTime() >= now.getTime() - REMINDER_NOTIFICATION_GRACE_MS;
}
