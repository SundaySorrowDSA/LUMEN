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
    baseUrlEnv: "KINDROID_API_BASE_URL",
    modelEnv: "KINDROID_MODEL",
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
    baseUrlEnv: "OPENAI_API_BASE_URL",
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
  const credentialConfigured = Boolean(definition.credentialEnv && environment[definition.credentialEnv]);
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