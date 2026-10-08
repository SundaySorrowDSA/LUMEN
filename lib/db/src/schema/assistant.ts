import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const assistantConversationsTable = pgTable("assistant_conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const assistantMessagesTable = pgTable("assistant_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantMemoryTable = pgTable("assistant_memory", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantProviderSettingsTable = pgTable("assistant_provider_settings", {
  id: serial("id").primaryKey(),
  activeProviderId: text("active_provider_id").notNull().default("kindroid"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const assistantPrivacySettingsTable = pgTable("assistant_privacy_settings", {
  id: integer("id").primaryKey(),
  darkMode: boolean("dark_mode").notNull().default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const assistantRemindersTable = pgTable("assistant_reminders", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => assistantConversationsTable.id),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
  chatStatus: text("chat_status").notNull().default("pending"),
  chatDeliveredAt: timestamp("chat_delivered_at", { withTimezone: true }),
  pushStatus: text("push_status").notNull().default("pending"),
  pushAttemptedAt: timestamp("push_attempted_at", { withTimezone: true }),
  pushLastError: text("push_last_error"),
});

export const assistantPushSubscriptionsTable = pgTable(
  "assistant_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("assistant_push_subscriptions_endpoint_idx").on(table.endpoint)],
);

export const insertAssistantConversationSchema = createInsertSchema(assistantConversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAssistantMessageSchema = createInsertSchema(assistantMessagesTable).omit({ id: true, createdAt: true });
export const insertAssistantMemorySchema = createInsertSchema(assistantMemoryTable).omit({ id: true, createdAt: true });

export type InsertAssistantConversation = z.infer<typeof insertAssistantConversationSchema>;
export type AssistantConversation = typeof assistantConversationsTable.$inferSelect;
export type InsertAssistantMessage = z.infer<typeof insertAssistantMessageSchema>;
export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;
export type InsertAssistantMemory = z.infer<typeof insertAssistantMemorySchema>;
export type AssistantMemory = typeof assistantMemoryTable.$inferSelect;
export const insertAssistantProviderSettingsSchema = createInsertSchema(assistantProviderSettingsTable).omit({ id: true, updatedAt: true });
export type AssistantProviderSettings = typeof assistantProviderSettingsTable.$inferSelect;
export type AssistantReminder = typeof assistantRemindersTable.$inferSelect;
export type AssistantPushSubscription = typeof assistantPushSubscriptionsTable.$inferSelect;