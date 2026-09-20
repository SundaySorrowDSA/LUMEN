export type ProviderId =
  | "local-preview"
  | "kindroid"
  | "openai"
  | "anthropic"
  | (string & {});

export type ProviderStatus = "active" | "ready" | "not_configured" | "planned";

export type ProviderDescriptor = {
  id: ProviderId;
  name: string;
  vendor: string;
  description: string;
  status: ProviderStatus;
  configured: boolean;
  model: string;
  baseUrlConfigured: boolean;
  credentialConfigured: boolean;
  credentialSecret: string | null;
  capabilities: string[];
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  messages: ModelMessage[];
  requestedProvider?: ProviderId;
};

export type ModelResult = {
  providerId: ProviderId;
  model: string;
  content: string;
  metadata: {
    mode: "preview" | "provider";
    routedBy: "provider-router";
  };
};

export type ModelProvider = {
  descriptor: ProviderDescriptor;
  complete(request: ModelRequest): Promise<ModelResult>;
};

export type ProviderEnvironment = Record<string, string | undefined>;

type ProviderDefinition = Omit<
  ProviderDescriptor,
  "status" | "configured" | "baseUrlConfigured" | "credentialConfigured"
> & {
  credentialEnv: string | null;
  additionalRequiredEnvs?: string[];
  baseUrlEnv: string | null;
  modelEnv: string | null;
  defaultModel: string;
  statusWhenConfigured: ProviderStatus;
};

const definitions: ProviderDefinition[] = [
  {
    id: "local-preview",
    name: "Local preview",
    vendor: "Lumen",
    description: "A no-key route for building and reviewing the workspace.",
    model: "local-preview",
    defaultModel: "local-preview",
    credentialSecret: null,
    credentialEnv: null,
    baseUrlEnv: null,
    modelEnv: null,
    capabilities: ["conversation", "memory"],
    statusWhenConfigured: "active",
  },
  {
    id: "kindroid",
    name: "Kindroid",
    vendor: "Kindroid",
    description: "A separate provider slot for a more personal conversational voice.",
    model: "kindroid",
    defaultModel: "kindroid",
    credentialSecret: "KINDROID_API_KEY",
    credentialEnv: "KINDROID_API_KEY",
    additionalRequiredEnvs: ["KINDROID_AI_ID"],
    baseUrlEnv: null,
    modelEnv: null,
    capabilities: ["conversation"],
    statusWhenConfigured: "ready",
  },
  {
    id: "openai",
    name: "OpenAI",
    vendor: "OpenAI",
    description: "An independent provider slot for OpenAI-compatible models.",
    model: "openai",
    defaultModel: "gpt-5.6-terra",
    credentialSecret: "OPENAI_API_KEY",
    credentialEnv: "OPENAI_API_KEY",
    baseUrlEnv: null,
    modelEnv: "OPENAI_MODEL",
    capabilities: ["conversation", "vision", "tools"],
    statusWhenConfigured: "ready",
  },
  {
    id: "anthropic",
    name: "Anthropic / Claude",
    vendor: "Anthropic",
    description: "An independent provider slot for Claude models.",
    model: "anthropic",
    defaultModel: "claude-sonnet",
    credentialSecret: "ANTHROPIC_API_KEY",
    credentialEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_API_BASE_URL",
    modelEnv: "ANTHROPIC_MODEL",
    capabilities: ["conversation", "vision", "tools"],
    statusWhenConfigured: "ready",
  },
];

function getConfiguredDefinition(
  definition: ProviderDefinition,
  environment: ProviderEnvironment,
): ProviderDescriptor {
  const requiredCredentialEnvs = [
    ...(definition.credentialEnv ? [definition.credentialEnv] : []),
    ...(definition.additionalRequiredEnvs ?? []),
  ];
  const credentialConfigured =
    requiredCredentialEnvs.length > 0 && requiredCredentialEnvs.every((name) => Boolean(environment[name]));
  const baseUrlConfigured = Boolean(!definition.baseUrlEnv || environment[definition.baseUrlEnv]);
  const configured = definition.id === "local-preview" || (credentialConfigured && baseUrlConfigured);

  return {
    id: definition.id,
    name: definition.name,
    vendor: definition.vendor,
    description: definition.description,
    status: configured ? definition.statusWhenConfigured : definition.id === "local-preview" ? "active" : "not_configured",
    configured,
    model: (definition.modelEnv && environment[definition.modelEnv]) || definition.defaultModel,
    baseUrlConfigured,
    credentialConfigured,
    credentialSecret: definition.credentialSecret,
    capabilities: definition.capabilities,
  };
}

export function listProviderDescriptors(environment: ProviderEnvironment = {}): ProviderDescriptor[] {
  return definitions.map((definition) => getConfiguredDefinition(definition, environment));
}

export function getProviderDescriptor(
  providerId: string | undefined,
  environment: ProviderEnvironment = {},
): ProviderDescriptor | undefined {
  return listProviderDescriptors(environment).find((provider) => provider.id === providerId);
}

type ProviderFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

export type ProviderFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<ProviderFetchResponse>;

export type KindroidProviderOptions = {
  apiKey: string;
  aiId: string;
  fetch: ProviderFetch;
};

export type OpenAIProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch: ProviderFetch;
  timeoutMs?: number;
  maxInputChars?: number;
  maxOutputTokens?: number;
};

function redactKindroidError(value: string, apiKey: string, aiId: string): string {
  return value
    .replaceAll(apiKey, "[redacted]")
    .replaceAll(aiId, "[redacted]")
    .trim()
    .slice(0, 240);
}

export function createKindroidProvider(options: KindroidProviderOptions): ModelProvider {
  const descriptor = getProviderDescriptor("kindroid", {
    KINDROID_API_KEY: options.apiKey,
    KINDROID_AI_ID: options.aiId,
  });
  if (!descriptor) throw new Error("Kindroid provider definition is missing");

  return {
    descriptor,
    async complete(request) {
      const latestUserMessage = [...request.messages].reverse().find((message) => message.role === "user");
      if (!latestUserMessage?.content.trim()) {
        throw new Error("Kindroid requires a non-empty user message");
      }

      let response: ProviderFetchResponse;
      try {
        response = await options.fetch("https://api.kindroid.ai/v1/send-message", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ai_id: options.aiId,
            message: latestUserMessage.content,
            stream: false,
          }),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown network error";
        throw new Error(`Kindroid request failed before a response was received: ${redactKindroidError(detail, options.apiKey, options.aiId)}`);
      }

      const content = await response.text();
      if (!response.ok) {
        const detail = redactKindroidError(content, options.apiKey, options.aiId);
        throw new Error(
          `Kindroid API returned ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
        );
      }
      if (!content.trim()) {
        throw new Error("Kindroid API returned an empty response");
      }

      return {
        providerId: "kindroid",
        model: descriptor.model,
        content,
        metadata: { mode: "provider", routedBy: "provider-router" },
      };
    },
  };
}

function redactOpenAIError(value: string, apiKey: string): string {
  return value
    .replaceAll(apiKey, "[redacted]")
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .trim()
    .slice(0, 240);
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: unknown;
    output?: Array<{
      type?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>;
  };
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
}

function boundMessages(messages: ModelMessage[], maxInputChars: number): ModelMessage[] {
  const bounded: ModelMessage[] = [];
  let remaining = maxInputChars;
  for (const message of messages.slice(-8)) {
    if (remaining <= 0) break;
    const content = message.content.slice(0, remaining);
    if (content) {
      bounded.push({ ...message, content });
      remaining -= content.length;
    }
  }
  return bounded;
}

async function fetchWithTimeout(
  fetcher: ProviderFetch,
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
  timeoutMs: number,
): Promise<ProviderFetchResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }),
      new Promise<ProviderFetchResponse>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`OpenAI request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createOpenAIProvider(options: OpenAIProviderOptions): ModelProvider {
  const model = options.model?.trim() || "gpt-5.6-terra";
  const descriptor = getProviderDescriptor("openai", {
    OPENAI_API_KEY: options.apiKey,
    OPENAI_MODEL: model,
  });
  if (!descriptor) throw new Error("OpenAI provider definition is missing");

  const baseUrl = (options.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxInputChars = options.maxInputChars ?? 8_000;
  const maxOutputTokens = options.maxOutputTokens ?? 400;

  return {
    descriptor,
    async complete(request) {
      const messages = boundMessages(request.messages, maxInputChars);
      if (!messages.some((message) => message.role === "user" && message.content.trim())) {
        throw new Error("OpenAI consultation requires a non-empty user message");
      }

      let response: ProviderFetchResponse;
      try {
        response = await fetchWithTimeout(
          options.fetch,
          `${baseUrl}/responses`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              store: false,
              max_output_tokens: maxOutputTokens,
              input: messages,
            }),
          },
          timeoutMs,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown network error";
        throw new Error(`OpenAI consultation failed before a response was received: ${redactOpenAIError(detail, options.apiKey)}`);
      }

      const content = await response.text();
      if (!response.ok) {
        let detail = content;
        try {
          const payload = JSON.parse(content) as { error?: { message?: string } };
          detail = payload.error?.message ?? content;
        } catch {
          // Preserve a bounded plain-text error when the provider does not return JSON.
        }
        throw new Error(
          `OpenAI API returned ${response.status} ${response.statusText}${detail ? `: ${redactOpenAIError(detail, options.apiKey)}` : ""}`,
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(content);
      } catch {
        throw new Error("OpenAI API returned invalid JSON");
      }
      const answer = extractOpenAIText(payload);
      if (!answer) throw new Error("OpenAI API returned an empty response");

      return {
        providerId: "openai",
        model: descriptor.model,
        content: answer.slice(0, maxOutputTokens * 20),
        metadata: { mode: "provider", routedBy: "provider-router" },
      };
    },
  };
}

function previewResponse(request: ModelRequest): ModelResult {
  const latest = [...request.messages].reverse().find((message) => message.role === "user");
  const content = latest?.content.toLowerCase() ?? "";
  let reply =
    "I’m ready to keep the thread moving. The provider router is active, but no live provider credentials are configured yet, so this request is being preserved in preview mode.";
  if (content.includes("remember") || content.includes("memory")) {
    reply = "I can route that to memory after you review it. The no-key preview keeps the request in this conversation without silently saving anything.";
  } else if (content.includes("research") || content.includes("latest")) {
    reply = "I can route research requests to a connected provider later. For now, the router is intentionally honest: no live web or model call was made.";
  }
  return {
    providerId: "local-preview",
    model: "local-preview",
    content: reply,
    metadata: { mode: "preview", routedBy: "provider-router" },
  };
}

export class ProviderRouter {
  private readonly providers = new Map<ProviderId, ModelProvider>();
  private readonly environment: ProviderEnvironment;

  constructor(environment: ProviderEnvironment = {}) {
    this.environment = environment;
    const local = getProviderDescriptor("local-preview", environment);
    if (!local) throw new Error("Local preview provider is missing");
    this.providers.set("local-preview", {
      descriptor: local,
      complete: async (request) => previewResponse(request),
    });
  }

  list(): ProviderDescriptor[] {
    const builtIns = listProviderDescriptors(this.environment);
    const registered = [...this.providers.values()].map((provider) => provider.descriptor);
    const registeredIds = new Set(registered.map((provider) => provider.id));
    return [
      ...builtIns.filter((provider) => !registeredIds.has(provider.id)),
      ...registered,
    ];
  }

  register(provider: ModelProvider): void {
    this.providers.set(provider.descriptor.id, provider);
  }

  select(requestedProvider?: ProviderId): ProviderDescriptor {
    const requested = this.list().find((provider) => provider.id === requestedProvider);
    if (requested?.configured) return requested;
    return this.list().find((provider) => provider.id === "local-preview")!;
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    const selected = this.select(request.requestedProvider);
    const provider = this.providers.get(selected.id);
    if (!provider) {
      return {
        ...previewResponse(request),
        providerId: selected.id,
        model: selected.model,
        metadata: { mode: "preview", routedBy: "provider-router" },
      };
    }
    return provider.complete(request);
  }
}