export const TEST_IMAGE_MODEL = "gpt-image-2.5-flare";
export const TEST_IMAGE_PROMPT =
  "A small black crow standing on a gold coin, cinematic lighting.";

export class TestImageError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
  }
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
      // Do not expose provider response bodies or credentials to the browser/logs.
      throw new TestImageError(
        502,
        `OpenAI image generation failed (HTTP ${response.status}). Check model access and server-side configuration.`,
        response.status,
      );
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof TestImageError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new TestImageError(504, "OpenAI image generation timed out. Please try again.");
    }
    throw new TestImageError(502, "OpenAI image generation could not return a valid response.");
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
