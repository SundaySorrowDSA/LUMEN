import type { AssistantMessage } from '@workspace/api-client-react';

export type OptimisticMessage = {
  conversationId: number;
  content: string;
  submittedAt: string;
  status: 'pending' | 'failed';
};

export type DisplayMessage = AssistantMessage | (OptimisticMessage & {
  id: string;
  role: 'user';
  createdAt: string;
  model: null;
  metadata: null;
  optimistic: true;
});

const RECONCILIATION_CLOCK_SKEW_MS = 5_000;

export function appendUniqueMessages(
  messages: AssistantMessage[],
  additions: AssistantMessage[],
) {
  const knownIds = new Set(messages.map((message) => message.id));
  return [
    ...messages,
    ...additions.filter((message) => {
      if (knownIds.has(message.id)) return false;
      knownIds.add(message.id);
      return true;
    }),
  ];
}

export function hasAuthoritativeMatch(
  optimistic: OptimisticMessage,
  messages: AssistantMessage[],
) {
  const submittedAt = Date.parse(optimistic.submittedAt);
  return messages.some((message) => (
    message.conversationId === optimistic.conversationId
    && message.role === 'user'
    && message.content === optimistic.content
    && Date.parse(message.createdAt) >= submittedAt - RECONCILIATION_CLOCK_SKEW_MS
  ));
}

export function buildDisplayMessages(
  messages: AssistantMessage[],
  optimisticMessages: OptimisticMessage[],
): DisplayMessage[] {
  const unreconciled = optimisticMessages.filter(
    (optimistic) => !hasAuthoritativeMatch(optimistic, messages),
  );
  return [
    ...messages,
    ...unreconciled.map((optimistic) => ({
      ...optimistic,
      id: `optimistic-${optimistic.conversationId}-${optimistic.submittedAt}`,
      role: 'user' as const,
      createdAt: optimistic.submittedAt,
      model: null,
      metadata: null,
      optimistic: true as const,
    })),
  ];
}
