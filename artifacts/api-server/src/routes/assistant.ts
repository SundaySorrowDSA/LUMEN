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
import {
  createKindroidProvider,
  ProviderRouter,
  type ProviderId,
} from "@workspace/assistant-providers";
import {
  buildWebSearchContext,
  requiresCurrentWebInformation,
  searchWeb,
} from "../tools/web-search.js";
import {
  buildCalculationContext,
  calculateForMessage,
  calculateWeeklyGrossPay,
  extractHourlyRate,
} from "../tools/calculator.js";
import {
  buildWorkScheduleContext,
  ensureWorkScheduleResponseAccuracy,
  getTotalScheduledHours,
  getWorkSchedule,
  requiresWorkScheduleInformation,
} from "../tools/work-schedule.js";

const router: IRouter = Router();
const providerRouter = new ProviderRouter(process.env);
const DEFAULT_PROVIDER_ID: ProviderId = "kindroid";
const kindroidApiKey = process.env.KINDROID_API_KEY;
const kindroidAiId = process.env.KINDROID_AI_ID;

if (kindroidApiKey && kindroidAiId) {
  providerRouter.register(
    createKindroidProvider({
      apiKey: kindroidApiKey,
      aiId: kindroidAiId,
      fetch,
    }),
  );
}

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
    description: "Live web search for current information and source links.",
    status: "Active",
    icon: "globe",
    available: true,
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
    await db.insert(assistantProviderSettingsTable).values({ activeProviderId: DEFAULT_PROVIDER_ID });
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
  const selectedProviderId = (settings?.activeProviderId ?? DEFAULT_PROVIDER_ID) as ProviderId;
  const selectedProvider = providerRouter.list().find((provider) => provider.id === selectedProviderId);
  return selectedProvider?.configured ? selectedProviderId : "local-preview";
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
  const workScheduleRequested = requiresWorkScheduleInformation(body.content);
  const workSchedule = workScheduleRequested
    ? await getWorkSchedule(body.content, process.env.WHEN_I_WORK_CALENDAR_URL)
    : null;
  const hourlyRate = workSchedule ? extractHourlyRate(body.content) : null;
  const calculation =
    workSchedule && hourlyRate !== null && /\b(?:earn|gross\s+pay|make|paid)\b/i.test(body.content)
      ? calculateWeeklyGrossPay(getTotalScheduledHours(workSchedule), hourlyRate)
      : calculateForMessage(body.content);
  const webSearchRequested =
    !workScheduleRequested &&
    !calculation &&
    requiresCurrentWebInformation(body.content);
  const webSearch = webSearchRequested
    ? await searchWeb(body.content)
    : null;
  let providerContent = webSearch
    ? buildWebSearchContext(body.content, webSearch)
    : body.content;
  if (workSchedule) {
    providerContent = buildWorkScheduleContext(providerContent, workSchedule);
  }
  if (calculation) {
    providerContent = buildCalculationContext(providerContent, calculation);
  }
  const result = await providerRouter.complete({
    requestedProvider: (body.providerId ?? activeProviderId) as ProviderId,
    messages: conversation.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }))
      .concat({ role: "user", content: providerContent }),
  });
  const assistantContent = workSchedule
    ? ensureWorkScheduleResponseAccuracy(result.content, workSchedule)
    : result.content;

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
      content: assistantContent,
      model: result.model,
      metadata: JSON.stringify({
        providerId: result.providerId,
        route: result.metadata.routedBy,
        mode: result.metadata.mode,
        sources: webSearch?.results.map(({ title, url }) => ({ title, url })) ?? [],
        tools: [
          ...(webSearch
          ? [{
              id: webSearch.tool,
              query: webSearch.query,
              retrievedAt: webSearch.retrievedAt,
            }]
          : []),
          ...(workSchedule
            ? [{
                id: workSchedule.tool,
                requestType: workSchedule.requestType,
                retrievedAt: workSchedule.retrievedAt,
                eventCount: workSchedule.events.length,
              }]
            : []),
          ...(calculation
            ? [{
                id: calculation.tool,
                kind: calculation.kind,
                expression: calculation.expression,
                result: calculation.result,
                resultText: calculation.resultText,
                ...(calculation.breakdown
                  ? { breakdown: calculation.breakdown }
                  : {}),
              }]
            : []),
        ],
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