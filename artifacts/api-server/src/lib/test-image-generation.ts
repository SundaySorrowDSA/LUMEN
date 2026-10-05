import type { OpenAiImageError } from "@workspace/api-zod";

export const TEST_IMAGE_MODEL = "gpt-image-2.5-flare";
export const TEST_IMAGE_PROMPT =
  "A small black crow standing on a gold coin, cinematic lighting.";

export class TestImageError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly upstreamStatus?: number,
    public readonly developmentDiagnostics?: {
      body: string;
      error: OpenAiImageError;
    },
    public readonly retryable = false,
  ) {
    super(message);
  }
}

// Provider errors can echo credentials. Never log request headers, and redact
// credentials even when they occur in the provider's response body/message.
function redactCredentials(text: string, apiKey: string): string {
  return text
    .split(apiKey).join("[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_*-]+/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED]")
    .replace(
      /(["']?(?:authorization|proxy-authorization|x-api-key|api[_-]?key)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,}]+)/gi,
      '$1"[REDACTED]"',
    );
}

async function readDevelopmentDiagnostics(response: Response, apiKey: string) {
  const rawBody = await response.text().catch(() => "[OpenAI error response body could not be read]");
  let providerError: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed?.error && typeof parsed.error === "object") providerError = parsed.error;
  } catch {
    // Keep the complete non-JSON response in the development log.
  }
  const field = (name: string): string | null => {
    const value = providerError[name];
    return typeof value === "string" ? redactCredentials(value, apiKey) : null;
  };
  const error: OpenAiImageError = {
    status: response.status,
    message: field("message") ?? `OpenAI returned HTTP ${response.status} without a structured error message. See the development console for the response body.`,
    code: field("code"),
    type: field("type"),
    param: field("param"),
  };
  const moderation = providerError.moderation_details as { moderation_stage?: unknown } | undefined;
  const retryable = [408, 429, 500, 502, 503, 504].includes(response.status) ||
    (providerError.code === "moderation_blocked" && moderation?.moderation_stage === "output");
  return { body: redactCredentials(rawBody, apiKey), error, retryable };
}

/** One transient Images API request, unrelated to the conversation provider router. */
export async function generateTestImage(
  apiKey: string,
  prompt: string,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  let response: Response;
  let payload: unknown;
  try {
    response = await fetcher("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TEST_IMAGE_MODEL,
        prompt,
        n: 1,
        output_format: "png",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const details = await readDevelopmentDiagnostics(response, apiKey);
      throw new TestImageError(
        502,
        `OpenAI image generation failed (HTTP ${response.status}). Check model access and server-side configuration.`,
        response.status,
        process.env.NODE_ENV === "development" ? details : undefined,
        details.retryable,
      );
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof TestImageError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new TestImageError(504, "OpenAI image generation timed out. Please try again.", undefined, undefined, true);
    }
    throw new TestImageError(502, "OpenAI image generation could not return a valid response.", undefined, undefined, error instanceof TypeError);
  }

  const encoded = (payload as { data?: Array<{ b64_json?: unknown }> } | null)
    ?.data?.[0]?.b64_json;
  if (
    typeof encoded !== "string" ||
    !encoded.length ||
    encoded.length > 40_000_000 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new TestImageError(502, "OpenAI did not return a valid PNG image.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new TestImageError(502, "OpenAI did not return a valid PNG image.");
  }
  return bytes;
}

/** Shared bounded orchestration. Both sandbox and generate_image use this path. */
export async function generateImage(
  apiKey: string,
  prompt: string,
  fetcher: typeof fetch = fetch,
  onTrace: (event: Record<string, unknown>) => void = () => {},
): Promise<Buffer> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    onTrace({ stage: "image_generation_attempt", tool: "generate_image", model: TEST_IMAGE_MODEL, attempt, promptLength: prompt.length });
    try {
      const image = await generateTestImage(apiKey, prompt, fetcher);
      onTrace({ stage: "image_generation_result", tool: "generate_image", attempt, imageBytes: image.length });
      return image;
    } catch (error) {
      const failure = error instanceof TestImageError ? error : new TestImageError(502, "Image generation failed.");
      onTrace({
        stage: "image_generation_attempt_failed",
        tool: "generate_image",
        attempt,
        upstreamStatus: failure.upstreamStatus,
        ...(process.env.NODE_ENV === "development" && failure.developmentDiagnostics
          ? { openaiResponseBody: failure.developmentDiagnostics.body, openaiError: failure.developmentDiagnostics.error }
          : {}),
      });
      if (attempt === 2 || !failure.retryable) throw failure;
      onTrace({ stage: "image_generation_retry", tool: "generate_image", nextAttempt: 2, identicalPrompt: true });
    }
  }
  throw new TestImageError(502, "Image generation failed.");
}
