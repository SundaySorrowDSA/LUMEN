import { extractImagePrompt, imageRequestClauses } from "./image-generation.js";

type ImageConversationContext = {
  assistantCharacter: "Ren" | null;
  toolPrompt?: string;
};

export type ConversationImageRequest = {
  prompt: string;
  resolvedAssistantSubject: boolean;
  reason: "current_outfit" | "assistant_reference" | "implicit_assistant_selfie" | "explicit_image_request";
};

/**
 * Resolve conversational roles, not character appearance. All Ren identity,
 * reference, and wardrobe construction stays in generateConversationImage.
 * An explicit tool prompt takes precedence over the accompanying chat text.
 */
export function resolveConversationImageRequest(
  content: string,
  context: ImageConversationContext,
): ConversationImageRequest | null {
  const prompt = context.toolPrompt ?? extractImagePrompt(content);
  const explicit = prompt === null ? null : {
    prompt, resolvedAssistantSubject: false, reason: "explicit_image_request" as const,
  };
  if (context.assistantCharacter !== "Ren") return explicit;

  const request = context.toolPrompt ?? content;
  const clauses = imageRequestClauses(request);
  const outfitPattern = /^\s*(?:please\s+)?show\s+(?:me|us)\s+what\s+you(?:['’]re|\s+are)\s+wearing\b([\s\S]*)$/i;
  const directOutfit = clauses.map(clause => clause.match(outfitPattern)).find(Boolean);
  const framedOutfit = prompt?.match(/^(selfie|portrait|image|picture|illustration|photo)\s+showing\s+(?:me|us)\s+what\s+you(?:['’]re|\s+are)\s+wearing\b([\s\S]*)$/i);
  if (directOutfit || framedOutfit) {
    const framing = framedOutfit?.[1] ?? "image";
    const suffix = (framedOutfit?.[2] ?? directOutfit?.[1] ?? "").trim();
    return {
      // A query about existing clothes is not an instruction to select new
      // clothing. "Current outfit" preserves that meaning for the old selector.
      prompt: `${framing} of Ren showing the viewer her current outfit${suffix ? `${/^[.!?]/.test(suffix) ? "" : " "}${suffix}` : ""}${directOutfit && !outfitPattern.test(clauses[0]) ? `\nScene context from the user's request: ${request}` : ""}`,
      resolvedAssistantSubject: true, reason: "current_outfit",
    };
  }

  // In this conversation an unqualified picture request is directed at Ren.
  // Do not use this fallback for named subjects, negations, or image discussion.
  if (prompt === null && clauses.some(clause => /^(?:please\s+)?(?:send|show|take|generate|create|make)\s+(?:(?:me|us)\s+)?(?:an?\s+)?(?:picture|photo|image|portrait|selfie)\s*[.!?]*$/i.test(clause))) {
    return {
      prompt: "image of Ren showing the viewer her current outfit",
      resolvedAssistantSubject: true, reason: "implicit_assistant_selfie",
    };
  }

  const seeAssistant = request.match(/^\s*(?:please\s+)?let\s+(?:me|us)\s+see\s+you(?:rself)?\b([\s\S]*)$/i);
  if (seeAssistant) return {
    prompt: `image of Ren${seeAssistant[1]}`,
    resolvedAssistantSubject: true, reason: "assistant_reference",
  };

  if (prompt === null) return null;
  if (/^selfie[.!]?\s*$/i.test(prompt)) return {
    prompt: "selfie of Ren",
    resolvedAssistantSubject: true, reason: "implicit_assistant_selfie",
  };
  // Only a primary depicted "you/yourself" denotes the assistant. Do not
  // rewrite user subjects ("me/myself") or possessions ("your book"), nor
  // a secondary "you" in e.g. "a crow looking at you".
  const subject = /^((?:(?:selfie|portrait|image|picture|illustration|photo)\s+(?:of|depicting|showing)\s+)?)(you(?:rself)?)\b/i;
  if (subject.test(prompt)) return {
    prompt: prompt.replace(subject, "$1Ren"),
    resolvedAssistantSubject: true, reason: "assistant_reference",
  };
  return explicit;
}
