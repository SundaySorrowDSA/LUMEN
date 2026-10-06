import { extractImagePrompt, imageRequestClauses } from "./image-generation.js";

type ImageConversationContext = {
  assistantCharacter: "Ren" | null;
  toolPrompt?: string;
  messages?: ReadonlyArray<{ role: string; content: string; metadata?: string | null }>;
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
   const outfitPattern = /^\s*(?:please\s+)?show\s+(?:me|us)\s+(?:what\s+you(?:['’]re|\s+are)\s+wearing|your\s+(?:current\s+|today['’]s\s+)?outfit)\b([\s\S]*)$/i;
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

  if (prompt === null) {
    const pending = !context.toolPrompt && isImageFollowUp(content)
      ? pendingImageRequest(context.messages ?? []) : null;
    return pending;
  }
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

/** Short consent/readiness questions need a nearby unresolved image request.
 * Neither the word "today" nor a stale promise alone authorizes a paid call.
 */
function isImageFollowUp(content: string): boolean {
  const sentences = content.split(/[.!?\n]+\s*/).map(sentence => sentence.trim()).filter(Boolean);
  return sentences.length > 0 && sentences.every(sentence =>
    [sentence, ...imageRequestClauses(sentence)].some(clause =>
      /^(?:(?:yes|ok(?:ay)?|sure|please)(?:\s+(?:baby|babe|love))?|(?:are\s+you\s+)?ready(?:\s+(?:now|yet))?|(?:can\s+I|let\s+me)\s+see\s+(?:it|that)|(?:send|show|share)\s+(?:(?:me|us)\s+)?(?:it|that)(?:\s+(?:now|please))?|(?:what|how)\s+about\s+(?:that|the|my)\s+(?:picture|photo|image|selfie)|(?:go\s+ahead|do\s+it|try\s+again))[.!?]*$/i.test(clause)));
}

function pendingImageRequest(messages: NonNullable<ImageConversationContext["messages"]>): ConversationImageRequest | null {
  let pending: ConversationImageRequest | null = null;
  for (const message of messages.slice(-8)) {
    if (message.role === "user") {
      const direct = resolveConversationImageRequest(message.content, { assistantCharacter: "Ren" });
      if (direct) pending = direct;
      else if (!isImageFollowUp(message.content)) pending = null;
    } else if (message.role === "assistant") {
      let attached = false;
      try { attached = Boolean(JSON.parse(message.metadata ?? "{}").generatedImage); } catch { /* Legacy text metadata. */ }
      if (attached || /\b(?:cancel(?:led|ed)?|won['’]t|will not|can['’]t|cannot)\b[\s\S]*\b(?:send|generate|picture|photo|image|selfie)\b/i.test(message.content)) {
        pending = null;
      } else if (/\b(?:I(?:['’]ll| will|['’]m going to| am going to)|let me)\s+(?:send|share|show|take|generate|make|attach)\b[^.!?\n]{0,100}\b(?:picture|photo|image|selfie|portrait|outfit)\b/i.test(message.content)) {
        pending ??= {
          prompt: "image of Ren showing the viewer her current outfit",
          resolvedAssistantSubject: true, reason: "implicit_assistant_selfie",
        };
      }
    }
  }
  return pending;
}
