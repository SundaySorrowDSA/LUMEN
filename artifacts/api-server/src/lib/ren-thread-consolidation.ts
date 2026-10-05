export type MigrationMessage = {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  model: string | null;
  metadata: string | null;
  created_at: string;
};

export function readMessageMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Message metadata must be a JSON object; migration stopped.");
  }
  return parsed as Record<string, unknown>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function messageFingerprint(message: MigrationMessage): string {
  const { threadConsolidation: _provenance, ...metadata } = readMessageMetadata(message.metadata);
  // Equal text sent at different times is not a duplicate.
  return JSON.stringify([message.created_at, message.role, message.content, message.model, stableValue(metadata)]);
}

export function planConsolidation(canonical: MigrationMessage[], sources: MigrationMessage[]) {
  const seen = new Set(canonical.map(messageFingerprint));
  const existingSources = new Set(canonical.flatMap((message) => {
    const origin = readMessageMetadata(message.metadata).threadConsolidation as
      { sourceConversationId?: number; sourceMessageId?: number } | undefined;
    return origin ? [`${origin.sourceConversationId}:${origin.sourceMessageId}`] : [];
  }));
  const imports: MigrationMessage[] = [];
  const duplicates: MigrationMessage[] = [];
  for (const message of [...sources].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id - b.id)) {
    const fingerprint = messageFingerprint(message);
    if (seen.has(fingerprint) || existingSources.has(`${message.conversation_id}:${message.id}`)) {
      duplicates.push(message);
    } else {
      seen.add(fingerprint);
      imports.push(message);
    }
  }
  return { imports, duplicates };
}
