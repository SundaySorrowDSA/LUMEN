import { resolveConversationImageRequest } from "./conversation-image-request.js";
import { requiresCurrentWebInformation } from "./web-search.js";

/** Resolve image intent before any broad temporal/current-information keywords. */
export function resolveConversationIntent(
  content: string,
  context: Parameters<typeof resolveConversationImageRequest>[1],
) {
  const imageRequest = resolveConversationImageRequest(content, context);
  const personalOutfit = context.assistantCharacter === "Ren" &&
    /\b(?:your\s+(?:current\s+|today['’]s\s+)?outfit|what\s+(?:are\s+you|you(?:['’]re|\s+are))\s+wearing)\b/i.test(content);
  const explicitWebRequest = /\b(?:search\s+(?:the\s+)?(?:web|internet)|web search|look\s+up|find\s+online)\b/i.test(content);
  return {
    imageRequest,
    webSearchRequested: imageRequest === null &&
      (!personalOutfit || explicitWebRequest) && requiresCurrentWebInformation(content),
  };
}
