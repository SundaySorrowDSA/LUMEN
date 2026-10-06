import { extractImagePrompt, generatedImageFromMetadata, imageRequestClauses } from "./image-generation.js";
import { classifySemanticImageIntent, isAssistantImageOffer, referencesCurrentImage, visibleImageIntentText, type SemanticImageIntent } from "./semantic-image-intent.js";
import { depictsRen } from "./ren-image-prompt.js";

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

/** Resolve intent/roles, never appearance, wardrobe, provider, or moderation. */
export function resolveConversationImageRequest(
  content: string,
  context: ImageConversationContext,
): ConversationImageRequest | null {
  // Structured capability input has precedence and keeps the existing contract.
  if (context.toolPrompt !== undefined) return resolveExplicitPrompt(context.toolPrompt, context.assistantCharacter);
  const prompt = extractImagePrompt(content);
  if (context.assistantCharacter !== "Ren") return prompt === null ? null : resolveExplicitPrompt(prompt, null);
  if (/^\s*(?:\/image\s+|generate_image\s*:)/i.test(content)) {
    return prompt === null ? null : resolveExplicitPrompt(prompt, "Ren");
  }
  const intent = classifySemanticImageIntent(content);
  if (intent.blocked) return null;
  if (intent.target === "assistant") return presentRenRequest(content, intent, prompt);
  if (intent.target === "previous_image") {
    const state = recentImageContext(context.messages ?? []);
    const previous = intent.repeat ? state.pending ?? state.recent : state.pending;
    if (!previous) return null;
    return intent.repeat ? repeatRequest(previous, intent) : previous;
  }
  // Other subjects remain generic, never silently rewritten to Ren.
  // Quoted/code examples cannot authorize the legacy generic tool either.
  const visiblePrompt = extractImagePrompt(visibleImageIntentText(content));
  return prompt === null || visiblePrompt === null ? null : resolveExplicitPrompt(prompt, null);
}

function repeatRequest(previous: ConversationImageRequest, intent: SemanticImageIntent): ConversationImageRequest {
  return {
    ...previous,
    prompt: `${previous.prompt}\nGenerate a fresh image, not a reuse of the previous attachment.${intent.differentAngle ? " Use a different camera angle." : ""}`,
  };
}

function resolveExplicitPrompt(prompt: string, character: "Ren" | null): ConversationImageRequest {
  const explicit = { prompt, resolvedAssistantSubject: false, reason: "explicit_image_request" as const };
  if (character !== "Ren") return explicit;
  if (/^selfie[.!]?\s*$/i.test(prompt)) return {
    prompt: "selfie of Ren", resolvedAssistantSubject: true, reason: "implicit_assistant_selfie",
  };
  const framedOutfit = prompt.match(/^(selfie|portrait|image|picture|illustration|photo)\s+showing\s+(?:me|us)\s+what\s+you(?:['’]re|\s+are)\s+wearing\b([\s\S]*)$/i);
  if (framedOutfit) return {
    prompt: `${framedOutfit[1]} of Ren showing the viewer her current outfit${framedOutfit[2]}`,
    resolvedAssistantSubject: true, reason: "current_outfit",
  };
  // Presentation of an already resolved primary role, not phrase routing.
  const primaryRole = /^((?:(?:selfie|portrait|image|picture|illustration|photo)\s+(?:of|depicting|showing)\s+)?)(you(?:rself)?)\b/i;
  return primaryRole.test(prompt) ? {
    prompt: prompt.replace(primaryRole, "$1Ren"),
    resolvedAssistantSubject: true, reason: "assistant_reference",
  } : explicit;
}

function presentRenRequest(content: string, intent: SemanticImageIntent, explicitPrompt: string | null): ConversationImageRequest {
  if (explicitPrompt !== null) {
    const resolved = resolveExplicitPrompt(explicitPrompt, "Ren");
    if (resolved.resolvedAssistantSubject) return resolved;
  }
  if (intent.kind === "outfit") {
    const suffix = intent.clause.match(/\b(?:wearing|outfit)\b([\s\S]*)$/i)?.[1]?.trim() ?? "";
    const details = suffix ? `${/^[.!?]/.test(suffix) ? "" : " "}${suffix}` : "";
    const directClause = imageRequestClauses(content)[0];
    const scene = content.trim() !== intent.clause.trim() &&
      !/^\s*(?:can|could|would|will|are)\b/i.test(content)
      ? `\nScene context from the user's request: ${content}` : "";
    // Preserve the pre-existing canonical suffix/punctuation for direct outfit
    // prompts while letting the shared semantic classifier decide the route.
    const terminal = !scene && directClause?.endsWith(".") && !details.endsWith(".") ? "." : "";
    return {
      prompt: `${intent.framing} of Ren showing the viewer her current outfit${details}${terminal}${scene}`,
      resolvedAssistantSubject: true, reason: "current_outfit",
    };
  }
  const angle = intent.differentAngle ? " from a different angle" : "";
  // Keep scene/pose constraints from novel phrasings, not just their image noun.
  const context = /\b(?:in|at|with|while|smiling|sitting|standing|wearing|face|eyes|smile)\b/i.test(content)
    ? `\nScene context from the user's request: ${content}` : "";
  if (intent.framing === "selfie") return {
    prompt: `selfie of Ren${angle}${context}`, resolvedAssistantSubject: true, reason: "implicit_assistant_selfie",
  };
  if (intent.framing === "portrait") return {
    prompt: `portrait of Ren${intent.closeUp ? " in close-up" : ""}${angle}${context}`, resolvedAssistantSubject: true, reason: "assistant_reference",
  };
  return {
    prompt: `image of Ren showing the viewer her current outfit${angle}${context}`,
    resolvedAssistantSubject: true, reason: "assistant_reference",
  };
}

/** Bounded conversation state. Only attachment metadata completes delivery;
 * promises/narration never do. Explicit repeats may reference a delivered image.
 */
function recentImageContext(messages: NonNullable<ImageConversationContext["messages"]>) {
  let pending: ConversationImageRequest | null = null;
  let recent: ConversationImageRequest | null = null;
  for (const message of messages.slice(-8)) {
    if (message.role === "user") {
      const decision = classifySemanticImageIntent(message.content);
      const direct = decision.target !== "previous_image"
        ? resolveConversationImageRequest(message.content, { assistantCharacter: "Ren" }) : null;
      if (direct) pending = direct;
      else if (decision.target === "previous_image" && decision.repeat && (pending ?? recent)) {
        pending = repeatRequest((pending ?? recent)!, decision);
      } else if (decision.target !== "previous_image" && !referencesCurrentImage(message.content)) {
        pending = null;
        recent = null;
      }
    } else if (message.role === "assistant") {
      let completed = false;
      try { completed = Boolean(JSON.parse(message.metadata ?? "{}").generatedImage); } catch { /* Legacy metadata. */ }
      if (completed) {
        const saved = generatedImageFromMetadata(message.metadata ?? null);
        recent = pending ?? recent ?? (saved ? (
          depictsRen(saved.prompt) ? {
            prompt: "image of Ren showing the viewer her current outfit",
            resolvedAssistantSubject: true, reason: "assistant_reference",
          } : resolveExplicitPrompt(saved.prompt, null)
        ) : null);
        pending = null;
      } else if (classifySemanticImageIntent(message.content).blocked) {
        pending = null;
        recent = null;
      } else if (isAssistantImageOffer(message.content)) {
        pending ??= {
          prompt: "image of Ren showing the viewer her current outfit",
          resolvedAssistantSubject: true, reason: "implicit_assistant_selfie",
        };
      }
    }
  }
  return { pending, recent };
}
