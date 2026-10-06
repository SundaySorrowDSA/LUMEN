import type { Logger } from "pino";
import { generateImage, TEST_IMAGE_MODEL, TestImageError } from "../lib/test-image-generation.js";
import { saveGeneratedImage } from "../lib/generated-image-storage.js";

/** Explicit requests only, consistent with LUMEN's other orchestrated tools. */
export function extractImagePrompt(content: string): string | null {
  for (const clause of imageRequestClauses(content)) {
    const prompt = extractDirectImagePrompt(clause);
    if (prompt !== null) return prompt;
  }
  return null;
}

/** Sentence boundaries and polite questions, not arbitrary image mentions. */
export function imageRequestClauses(content: string): string[] {
  return [content, ...content.split(/[.!?\n]+\s*/)]
    .map(clause => clause.trim().replace(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i, ""))
    .filter(Boolean);
}

function extractDirectImagePrompt(content: string): string | null {
  const command = content.match(/^\s*(?:\/image\s+|generate_image\s*:\s*)([\s\S]+)$/i);
  if (command) return command[1].trim() || null;
  const natural = content.match(/^\s*(?:please\s+)?(?:generate|create|make|draw|send|take|show)\s+(?:(?:me|us)\s+)?(?:an?\s+)?(image|picture|illustration|selfie|portrait|photo)\s+(of|showing|depicting)\s+([\s\S]+)$/i);
  if (natural) {
    const subject = natural[3].trim();
    // "Showing me" may identify the viewer, not the depicted subject. Keep
    // the original relation instead of inventing "of me".
    return /^(?:selfie|portrait)$/i.test(natural[1]) || natural[2].toLowerCase() === "showing"
      ? `${natural[1]} ${natural[2]} ${subject}` : subject || null;
  }
  const bareSelfie = content.match(/^\s*(?:please\s+)?(?:generate|create|make|send|take)\s+(?:(?:me|us)\s+)?(?:an?\s+)?selfie[.!]?\s*$/i);
  if (bareSelfie) return "selfie";
  // Bounded object shorthand requested by the chat UI; do not reinterpret
  // arbitrary "generate a plan/report/schedule" requests as image calls.
  const object = content.match(/^\s*(?:please\s+)?(?:generate|create|make|draw|show\s+(?:me|us))\s+((?:an?\s+)?(?:castle|crow)\b[\s\S]*)$/i);
  if (object) return object[1].trim();
  const renPortrait = content.match(/^\s*(?:please\s+)?(?:generate|create|make|draw)\s+(?:(?:me|us)\s+)?(?:an?\s+)?Ren\s+(selfie|portrait|image|picture)(?:\s+([\s\S]+))?[.!]?\s*$/i);
  return renPortrait ? `${renPortrait[1]} of Ren${renPortrait[2] ? ` ${renPortrait[2].trim()}` : ''}` : null;
}

export const imageCapability = {
  name: "generate_image" as const,
  description: "Generate exactly one image from an explicit prompt; Ren remains the conversational responder.",
};

export async function generate_image(prompt: string, options: {
  apiKey: string;
  logger: Logger;
  fetcher?: typeof fetch;
  save?: (bytes: Buffer) => Promise<string>;
  referenceImage?: Buffer;
}) {
  if (!prompt.trim()) throw new TestImageError(400, "Image prompt must not be empty.");
  options.logger.info({ stage: "image_capability_requested", tool: imageCapability.name, promptLength: prompt.length }, "LUMEN image capability requested");
  const image = await generateImage(options.apiKey, prompt, options.fetcher,
    (event) => options.logger.info(event, "LUMEN image generation trace"), options.referenceImage);
  const objectPath = await (options.save ?? saveGeneratedImage)(image);
  options.logger.info({ stage: "image_stored", tool: imageCapability.name, imageBytes: image.length }, "Generated image saved to App Storage");
  return { tool: imageCapability.name, model: TEST_IMAGE_MODEL, prompt, objectPath, mimeType: "image/png" as const };
}

export function generatedImageFromMetadata(metadata: string | null) {
  try {
    const image = JSON.parse(metadata ?? "{}").generatedImage;
    return image && typeof image.prompt === "string" &&
      typeof image.objectPath === "string" && /^\/objects\/generated\/[a-f0-9-]+\.png$/.test(image.objectPath)
      ? image as { prompt: string; objectPath: string; model: string } : null;
  } catch { return null; }
}
