import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  CreateAssistantConversationBody,
  CreateAssistantMemoryBody,
  GetAssistantConversationParams,
  GetAssistantConversationResponse,
  GetAssistantOverviewResponse,
  ListAssistantConnectionsResponse,
  ListAssistantConversationsResponse,
  ListAssistantMemoryResponse,
  ListAssistantProvidersResponse,
  SelectAssistantProviderBody,
  SelectAssistantProviderResponse,
  SendAssistantMessageBody,
  SendAssistantMessageParams,
  SendAssistantMessageResponse,
} from "@workspace/api-zod";
import {
  assistantConversationsTable,
  assistantMemoryTable,
  assistantMessagesTable,
  assistantProviderSettingsTable,
  db,
} from "@workspace/db";
import { ProviderRouter, type ProviderId } from "@workspace/assistant-providers";

const router: IRouter = Router();
const providerRouter = new ProviderRouter(process.env);

const connectionCatalog = [
  {
    id: "memory",
    name: "Personal memory",
    description: "Saved preferences and context that stays with you.",
    status: "Active",
    icon: "brain",
    available: true,
  },
  {
    id: "web",
    name: "Web research",
    description: "Bring fresh information into a conversation.",
    status: "Connect later",
    icon: "globe",
    available: false,
  },
  {
    id: "google",
    name: "Google workspace",
    description: "Calendar, mail, and documents when you authorize access.",
    status: "Connect later",
    icon: "grid",
    available: false,
  },
  {
    id: "actions",
    name: "Permissioned actions",
    description: "Review before the assistant changes anything for you.",
    status: "Ready",
    icon: "shield",
    available: true,
  },
];

let workspaceSeedPromise: Promise<typeof assistantConversationsTable.$inferSelect> | null = null;

async function seedWorkspace() {
  const existing = await db.select().from(assistantConversationsTable).limit(1);
  let conversation = existing[0];

  if (!conversation) {
    [conversation] = await db
      .insert(assistantConversationsTable)
      .values({ title: "A place to think" })
      .returning();

    await db.insert(assistantMessagesTable).values({
      conversationId: conversation.id,
      role: "assistant",
      content:
        "Good morning. I’m here to help you think, research, and get things done without losing the thread. What should we work on?",
      model: "local-preview",
      metadata: JSON.stringify({ providerId: "local-preview", route: "provider-router", mode: "preview" }),
    });
  }

  const memoryCount = await db.select().from(assistantMemoryTable).limit(1);
  if (memoryCount.length === 0) {
    await db.insert(assistantMemoryTable).values([
      {
        label: "Working style",
        content: "Prefer clear options, direct recommendations, and no unnecessary ceremony.",
        category: "Preference",
      },
      {
        label: "Assistant principle",
        content: "Ask before taking an external action or changing something important.",
        category: "Boundary",
      },
    ]);
  }

  const providerSettings = await db.select().from(assistantProviderSettingsTable).limit(1);
  if (providerSettings.length === 0) {
    await db.insert(assistantProviderSettingsTable).values({ activeProviderId: "local-preview" });
  }

  return conversation;
}

function ensureWorkspaceSeed() {
  workspaceSeedPromise ??= seedWorkspace();
  return workspaceSeedPromise;
}

async function getActiveProviderId() {
  await ensureWorkspaceSeed();
  const [settings] = await db.select().from(assistantProviderSettingsTable).limit(1);
  return settings?.activeProviderId ?? "local-preview";
}

function providerResponseShape() {
  return providerRouter.list().map(({ credentialSecret: _credentialSecret, ...provider }) => provider);
}

async function conversationSummary(conversation: typeof assistantConversationsTable.$inferSelect) {
  const messages = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, conversation.id));

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: messages.length,
  };
}

async function getConversationWithMessages(id: number) {
  const [conversation] = await db
    .select()
    .from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.id, id));
  if (!conversation) return null;

  const messages = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, id))
    .orderBy(assistantMessagesTable.createdAt);

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages,
  };
}

router.get("/assistant/overview", async (_req, res) => {
  const activeConversation = await ensureWorkspaceSeed();
  const activeProviderId = await getActiveProviderId();
  const activeProvider = providerRouter.list().find((provider) => provider.id === activeProviderId) ?? providerRouter.list()[0];
  const [conversations, memory, messages] = await Promise.all([
    db.select().from(assistantConversationsTable),
    db.select().from(assistantMemoryTable),
    db.select().from(assistantMessagesTable).orderBy(desc(assistantMessagesTable.createdAt)).limit(4),
  ]);

  const data = GetAssistantOverviewResponse.parse({
    activeConversationId: activeConversation.id,
    conversationCount: conversations.length,
    memoryCount: memory.length,
    connectionCount: connectionCatalog.length,
    model: activeProvider.model,
    modelStatus: activeProvider.status === "active" ? "Active" : activeProvider.status,
    providerId: activeProvider.id,
    providerStatus: activeProvider.status,
    recentActivity: messages.map((message) => ({
      id: message.id,
      label: message.role === "assistant" ? "Assistant replied" : "You wrote",
      detail: message.content.slice(0, 96),
      createdAt: message.createdAt,
      tone: message.role === "assistant" ? "violet" : "blue",
    })),
  });
  res.json(data);
});

router.get("/assistant/providers", async (_req, res) => {
  await ensureWorkspaceSeed();
  res.json(ListAssistantProvidersResponse.parse(providerResponseShape()));
});

router.post("/assistant/providers/select", async (req, res) => {
  const body = SelectAssistantProviderBody.parse(req.body);
  await ensureWorkspaceSeed();
  const selected = providerRouter.list().find((provider) => provider.id === body.providerId);
  if (!selected) {
    res.status(400).json({ error: "Unknown provider" });
    return;
  }
  if (!selected.configured) {
    res.status(409).json({ error: `${selected.name} is not configured yet` });
    return;
  }

  const [settings] = await db.select().from(assistantProviderSettingsTable).limit(1);
  if (settings) {
    await db
      .update(assistantProviderSettingsTable)
      .set({ activeProviderId: selected.id, updatedAt: new Date() })
      .where(eq(assistantProviderSettingsTable.id, settings.id));
  } else {
    await db.insert(assistantProviderSettingsTable).values({ activeProviderId: selected.id });
  }

  res.json(
    SelectAssistantProviderResponse.parse({
      activeProviderId: selected.id,
      selectedProviderId: selected.id,
      status: selected.status,
    }),
  );
});

router.get("/assistant/conversations", async (_req, res) => {
  await ensureWorkspaceSeed();
  const conversations = await db
    .select()
    .from(assistantConversationsTable)
    .orderBy(desc(assistantConversationsTable.updatedAt));
  const data = await Promise.all(conversations.map(conversationSummary));
  res.json(ListAssistantConversationsResponse.parse(data));
});

router.post("/assistant/conversations", async (req, res) => {
  const body = CreateAssistantConversationBody.parse(req.body);
  const [conversation] = await db
    .insert(assistantConversationsTable)
    .values({ title: body.title })
    .returning();
  res.status(201).json(ListAssistantConversationsResponse.element.parse(await conversationSummary(conversation)));
});

router.get("/assistant/conversations/:id", async (req, res) => {
  const params = GetAssistantConversationParams.parse(req.params);
  const conversation = await getConversationWithMessages(params.id);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json(GetAssistantConversationResponse.parse(conversation));
});

router.delete("/assistant/conversations/:id", async (req, res) => {
  const params = GetAssistantConversationParams.parse(req.params);
  await db.delete(assistantMessagesTable).where(eq(assistantMessagesTable.conversationId, params.id));
  await db.delete(assistantConversationsTable).where(eq(assistantConversationsTable.id, params.id));
  res.status(204).send();
});

router.post("/assistant/conversations/:id/messages", async (req, res) => {
  const params = SendAssistantMessageParams.parse(req.params);
  const body = SendAssistantMessageBody.parse(req.body);
  const conversation = await getConversationWithMessages(params.id);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const activeProviderId = await getActiveProviderId();
  const result = await providerRouter.complete({
    requestedProvider: (body.providerId ?? activeProviderId) as ProviderId,
    messages: conversation.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }))
      .concat({ role: "user", content: body.content }),
  });

  const [userMessage] = await db
    .insert(assistantMessagesTable)
    .values({
      conversationId: params.id,
      role: "user",
      content: body.content,
      model: null,
      metadata: null,
    })
    .returning();
  const [assistantMessage] = await db
    .insert(assistantMessagesTable)
    .values({
      conversationId: params.id,
      role: "assistant",
      content: result.content,
      model: result.model,
      metadata: JSON.stringify({
        providerId: result.providerId,
        route: result.metadata.routedBy,
        mode: result.metadata.mode,
        sources: [],
        approvalRequired: false,
      }),
    })
    .returning();

  await db
    .update(assistantConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversationsTable.id, params.id));

  res.json(
    SendAssistantMessageResponse.parse({
      userMessage,
      assistantMessage,
    }),
  );
});

router.get("/assistant/memory", async (_req, res) => {
  await ensureWorkspaceSeed();
  const memory = await db.select().from(assistantMemoryTable).orderBy(desc(assistantMemoryTable.createdAt));
  res.json(ListAssistantMemoryResponse.parse(memory));
});

router.post("/assistant/memory", async (req, res) => {
  const body = CreateAssistantMemoryBody.parse(req.body);
  const [memory] = await db.insert(assistantMemoryTable).values(body).returning();
  res.status(201).json(memory);
});

router.delete("/assistant/memory/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid memory id" });
    return;
  }
  await db.delete(assistantMemoryTable).where(eq(assistantMemoryTable.id, id));
  res.status(204).send();
});

router.get("/assistant/connections", (_req, res) => {
  res.json(ListAssistantConnectionsResponse.parse(connectionCatalog));
});

export default router;