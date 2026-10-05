export const ACTIVE_CONVERSATION_KEY = 'lumen-active-conversation';

export function resolveConversationSelection(
  selected: number | null,
  conversations: Array<{ id: number; title: string }>,
  defaultId?: number,
): number | null {
  if (selected !== null && conversations.some((thread) => thread.id === selected)) return selected;
  return conversations.find((thread) => thread.title === 'A place to think')?.id
    ?? conversations.find((thread) => thread.id === defaultId)?.id
    ?? conversations[0]?.id ?? null;
}

export function readActiveConversation(): number | null {
  try {
    const id = Number(localStorage.getItem(ACTIVE_CONVERSATION_KEY));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
