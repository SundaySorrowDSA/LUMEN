import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const assistantConversationsTable = pgTable("assistant_conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
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

export const assistantRemindersTable = pgTable("assistant_reminders", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

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