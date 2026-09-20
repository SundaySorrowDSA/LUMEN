import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIProvider, type ProviderFetch } from "./index.js";

function response(status: number, body: unknown): Awaited<ReturnType<ProviderFetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Service Unavailable",
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

test("OpenAI consultation sends one bounded Responses API request and parses the answer", async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  const provider = createOpenAIProvider({
    apiKey: "test-openai-secret",
    model: "gpt-5.6-terra",
    maxInputChars: 120,
    fetch: async (_url, init) => {
      calls += 1;
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return response(200, {
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Keep the answer concise." }],
        }],
      });
    },
  });

  const result = await provider.complete({
    messages: [
      { role: "system", content: "Helper instructions" },
      { role: "user", content: "A".repeat(500) },
    ],
  });

  assert.equal(calls, 1);
  assert.equal(result.providerId, "openai");
  assert.equal(result.content, "Keep the answer concise.");
  assert.equal(requestBody?.model, "gpt-5.6-terra");
  assert.equal(requestBody?.store, false);
  assert.equal(requestBody?.max_output_tokens, 400);
  assert.ok(JSON.stringify(requestBody?.input).length <= 400);
});

test("OpenAI consultation reports provider failures without retrying", async () => {
  let calls = 0;
  const provider = createOpenAIProvider({
    apiKey: "test-openai-secret",
    fetch: async () => {
      calls += 1;
      return response(503, { error: { message: "temporary provider failure" } });
    },
  });

  await assert.rejects(
    provider.complete({ messages: [{ role: "user", content: "Please help." }] }),
    /OpenAI API returned 503 Service Unavailable: temporary provider failure/,
  );
  assert.equal(calls, 1);
});

test("OpenAI consultation has a bounded timeout and no retry", async () => {
  let calls = 0;
  const provider = createOpenAIProvider({
    apiKey: "test-openai-secret",
    timeoutMs: 5,
    fetch: async () => {
      calls += 1;
      return new Promise(() => undefined);
    },
  });

  await assert.rejects(
    provider.complete({ messages: [{ role: "user", content: "Please help." }] }),
    /OpenAI request timed out after 5ms/,
  );
  assert.equal(calls, 1);
});