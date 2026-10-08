import { integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { assistantRemindersTable } from "./assistant";

// Subscription IDs remain historical references after an expired endpoint is removed.
// Never store endpoint tokens or encryption keys in delivery receipts.
export const reminderPushReceiptsTable = pgTable("reminder_push_receipts", {
  id: serial("id").primaryKey(),
  reminderId: integer("reminder_id").notNull().references(() => assistantRemindersTable.id),
  subscriptionId: integer("subscription_id").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
}, table => [
  uniqueIndex("reminder_push_receipts_channel_idx").on(table.reminderId, table.subscriptionId),
]);

export const insertReminderPushReceiptSchema = createInsertSchema(reminderPushReceiptsTable).omit({ id: true });
export type ReminderPushReceipt = typeof reminderPushReceiptsTable.$inferSelect;
