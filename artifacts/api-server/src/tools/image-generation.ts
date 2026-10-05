import type { Logger } from "pino";
import { generateImage, TEST_IMAGE_MODEL, TestImageError } from "../lib/test-image-generation.js";
import { saveGeneratedImage } from "../lib/generated-image-storage.js";

/** Explicit requests only, consistent with LUMEN's other orchestrated tools. */
export function extractImagePrompt(content: string): string | null {
  const command = content.match(/^\s*(?:\/image\s+|generate_image\s*:\s*)([\s\S]+)$/i);
  if (command) return command[1].trim() || null;
  const natural = content.match(/^\s*(?:please\s+)?(?:generate|create|make|draw)\s+(?:(?:me|us)\s+)?(?:an?\s+)?(?:image|picture|illustration)\s+(?:of|showing|depicting)\s+([\s\S]+)$/i);
  return natural?.[1].trim() || null;
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
}) {
  if (!prompt.trim()) throw new TestImageError(400, "Image prompt must not be empty.");
  options.logger.info({ stage: "image_capability_requested", tool: imageCapability.name, promptLength: prompt.length }, "LUMEN image capability requested");
  const image = await generateImage(options.apiKey, prompt, options.fetcher,
    (event) => options.logger.info(event, "LUMEN image generation trace"));
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
