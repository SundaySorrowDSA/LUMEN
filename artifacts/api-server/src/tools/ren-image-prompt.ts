import { redactAssistantTraceText } from "../lib/assistant-tracing.js";
import { generate_image } from "./image-generation.js";
import { REN_VISUAL_REFERENCE } from "../config/ren-visual-reference.js";
import { loadRenVisualReference } from "../lib/ren-visual-reference.js";

export const REN_REFERENCE_IDENTITY_INSTRUCTION =
  "The supplied reference image defines Ren's canonical face and visual identity. It is the PRIMARY IDENTITY REFERENCE with high identity priority and low outfit priority. Preserve the same recognizable adult woman, facial structure, complexion, golden eyes, black hair, and overall identity. Do not copy clothing, pose, background, expression, jewelry, accessories, or feather arrangement from the identity reference unless separately requested. Current wardrobe and scene instructions remain independent.";

export const REN_CHARACTER_IDENTITY =
  "Ren is an adult woman with a distinctly feminine appearance, a petite/slender feminine build, a heart-shaped feminine face, a soft feminine jawline, a delicate nose, full feminine lips, large luminous golden eyes, long flowing black hair, porcelain-pale skin, elegant black feather accents, ornate gold jewelry, a dark elegant gothic aesthetic, and feminine styling and silhouette. Her facial features, styling, and silhouette must read as distinctly feminine, not masculine or androgynous. Preserve her adult female identity across all poses, framing, wardrobe choices, and rendering styles, including selfies and anime. Do not render Ren as male, masculine-presenting, bearded, broad-jawed, or as a masculine anime character.";
export const DEFAULT_REN_OUTFIT =
  "An elegant black high-neck outfit with black feather detailing and ornate gold jewelry.";

export type RenWardrobeState = {
  outfit: string;
  accessories?: string;
};

export type RenImagePromptSections = {
  characterIdentity: string;
  wardrobe: string;
  scene: string;
  poseAndFraming: string;
  styleAndMood: string;
  userRequestDetails: string;
};

type RenPromptResult =
  | { activated: false; prompt: string }
  | {
      activated: true;
      prompt: string;
      sections: RenImagePromptSections;
      wardrobeSource: "current_state" | "canonical_fallback";
    };

/** Match the character name, not substrings like "render" or the name "René". */
export function depictsRen(prompt: string): boolean {
  const mentions = [...prompt.matchAll(/(?<![\p{L}\p{N}_])ren(?![\p{L}\p{N}_])/giu)];
  return mentions.some((mention) => {
    const before = prompt.slice(0, mention.index);
    const after = prompt.slice(mention.index! + mention[0].length);
    // Negative references and text labels do not ask to depict the character.
    return !/\b(?:without|excluding|not|no|except)\s*$/i.test(before)
      && !/\b(?:word|text|label|named|called)\s+["']?\s*$/i.test(before)
      && !/^\s*[-']?s?\s+(?:name|signature|logo|aesthetic|style)\b/i.test(after);
  });
}

/** Pure deterministic construction: no provider, storage, or state mutations. */
export function buildRenImagePrompt(prompt: string, wardrobe?: RenWardrobeState | null): RenPromptResult {
  if (!depictsRen(prompt)) return { activated: false, prompt };

  const currentOutfit = wardrobe?.outfit.trim();
  const accessories = wardrobe?.accessories?.trim();
  const wardrobeSource = currentOutfit ? "current_state" : "canonical_fallback";
  const scene = prompt.match(/\b(?:at|in|inside|outside|by|beside|near|on|under|against)\s+[^.!?\n]+/i)?.[0];
  const pose = prompt.match(/\b(?:reading|standing|sitting|walking|lying|smiling|looking|dancing|posing)\b[^.!?\n]*?(?=\s+(?:at|in|inside|outside|by|beside|near|on|under|against)\b|[.!?\n]|$)/i)?.[0];
  const selfie = /\bselfie\b/i.test(prompt);
  const styleCues = prompt.match(/\b(?:cinematic|moody|soft|golden hour|watercolou?r|anime|photorealistic|realistic|oil painting|bright|cozy|dramatic)\b/gi);
  const sections: RenImagePromptSections = {
    characterIdentity: REN_CHARACTER_IDENTITY,
    wardrobe: currentOutfit
      ? `${currentOutfit}${accessories ? ` Accessories: ${accessories}` : ""}`
      : DEFAULT_REN_OUTFIT,
    scene: scene ?? "Use the requested environment; otherwise a simple, unobtrusive setting.",
    poseAndFraming: [
      selfie ? "A natural arm's-length selfie, camera facing Ren, close portrait framing." : "Use the requested camera angle and framing; otherwise a natural portrait view.",
      pose ? `Requested pose or activity: ${pose}.` : "Use the requested pose; otherwise relaxed, natural posture.",
    ].join(" "),
    styleAndMood: `Dark, elegant atmosphere with subtle golden highlights.${styleCues ? ` Requested style/mood cues: ${styleCues.join(", ")}.` : ""}`,
    userRequestDetails: prompt,
  };
  const labels: Record<keyof RenImagePromptSections, string> = {
    characterIdentity: "Character identity",
    wardrobe: "Current outfit / wardrobe",
    scene: "Scene / environment",
    poseAndFraming: "Pose / framing",
    styleAndMood: "Style / mood",
    userRequestDetails: "User-specific request details",
  };
  const assembled = (Object.keys(sections) as Array<keyof RenImagePromptSections>)
    .map((key) => `${labels[key]}:\n${sections[key]}`).join("\n\n");
  return {
    activated: true,
    wardrobeSource,
    sections,
    prompt: `Generate one image depicting Ren. Keep the canonical character identity consistent. ${REN_REFERENCE_IDENTITY_INSTRUCTION} Honor explicit scene, pose, framing, style, and wardrobe changes in the user-specific request; the wardrobe section is the baseline when no change is requested.\n\n${assembled}`,
  };
}

/** LUMEN preprocessor before the existing tool; the Image Sandbox never uses it. */
export async function generateConversationImage(
  prompt: string,
  options: Parameters<typeof generate_image>[1] & {
    readWardrobe?: () => Promise<RenWardrobeState | null>;
    readReferenceAsset?: (path: string) => Promise<Buffer>;
  },
) {
  // Ordinary image requests must not read wardrobe state or alter their prompt.
  const wardrobe = depictsRen(prompt) && options.readWardrobe ? await options.readWardrobe() : null;
  const built = buildRenImagePrompt(prompt, wardrobe);
  // Load once, outside retries. Ren must never silently fall back to an unanchored request.
  const referenceImage = built.activated ? await loadRenVisualReference(options.readReferenceAsset) : undefined;
  if (built.activated) {
    const sections = Object.fromEntries(Object.entries(built.sections).map(([key, value]) => [
      key,
      redactAssistantTraceText(value, 1600)
        .replace(/\bsk-[A-Za-z0-9_*-]+/g, "[REDACTED]")
        .split(options.apiKey || "\0").join("[REDACTED]"),
    ]));
    options.logger.info({
      stage: "ren_image_prompt_built", tool: "generate_image", character: "Ren",
      wardrobeSource: built.wardrobeSource,
      sectionNames: Object.keys(built.sections), sections,
      originalPromptLength: prompt.length, finalPromptLength: built.prompt.length,
      identityReferenceVersion: REN_VISUAL_REFERENCE.identityReferenceVersion,
      identityReferenceRole: REN_VISUAL_REFERENCE.role,
      referenceImageBytes: referenceImage!.length,
    }, "Ren canonical prompt builder used");
  } else {
    options.logger.info({
      stage: "ren_image_prompt_bypassed", tool: "generate_image", reason: "non_ren_request",
      promptLength: prompt.length,
    }, "Non-Ren image prompt passed through unchanged");
  }
  // Build once, outside the tool's retry loop, so any retry uses identical text.
  return generate_image(built.prompt, { ...options, referenceImage });
}
