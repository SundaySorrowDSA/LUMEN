import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import pinoHttp from "pino-http";
import pino from "pino";
import { Writable } from "node:stream";
import { createTestImageRouter } from "./test-image.js";
import { generateTestImage, TEST_IMAGE_MODEL, TEST_IMAGE_PROMPT } from "../lib/test-image-generation.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=",
  "base64",
);

test("image test validates prompts and returns PNGs for default and custom prompts without generating on GET", async () => {
  let calls = 0;
  let expectedPrompt = TEST_IMAGE_PROMPT;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: TEST_IMAGE_MODEL, prompt: expectedPrompt, n: 1, output_format: "png",
    });
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  };
  const app = express();
  app.use(pinoHttp({ logger: pino({ enabled: false }) }));
  app.use(express.json());
  app.use("/api", createTestImageRouter({ getApiKey: () => "test-only-key", fetcher }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/test-image`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Generate one image/);
    assert.equal(calls, 0);
    for (const body of [{}, { prompt: "" }, { prompt: " \n\t " }, { prompt: null }, { prompt: 42 }, { prompt: ["crow"] }, []]) {
      const invalid = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(invalid.status, 400);
      const failure = await invalid.json() as { error: string };
      assert.match(failure.error, /non-empty string/);
    }
    const missing = await fetch(url, { method: "POST" });
    assert.equal(missing.status, 400);
    assert.equal(calls, 0, "Invalid prompts must never call OpenAI");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: TEST_IMAGE_PROMPT }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/png/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(calls, 1);
    expectedPrompt = "A blue fox sleeping beside a silver river.";
    const custom = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: `  ${expectedPrompt}  ` }),
    });
    assert.equal(custom.status, 200);
    assert.deepEqual(Buffer.from(await custom.arrayBuffer()), png);
    assert.equal(calls, 2, "Custom prompts use the same single-image implementation");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("OpenAI failures are explicit and do not expose upstream bodies", async () => {
  await assert.rejects(
    generateTestImage("test-only-key", TEST_IMAGE_PROMPT, async () => new Response("private provider details", { status: 403 })),
    (error: Error) => /HTTP 403/.test(error.message) && !/private/.test(error.message),
  );
  await assert.rejects(
    generateTestImage("test-only-key", TEST_IMAGE_PROMPT, async () => Response.json({ data: [] })),
    /valid PNG image/,
  );
  await assert.rejects(
    generateTestImage("test-only-key", TEST_IMAGE_PROMPT, async () => Response.json({ data: [{ b64_json: "not-an-image" }] })),
    /valid PNG image/,
  );
});

test("development returns and logs complete redacted OpenAI diagnostics; production keeps them private", async () => {
  const originalEnvironment = process.env.NODE_ENV;
  const testKey = "test-credential-not-real";
  const fullContext = "Detailed upstream context. ".repeat(400);
  const providerBody = JSON.stringify({
    error: {
      message: `Prompt was rejected. Echoed key: ${testKey}`,
      code: "invalid_image_prompt",
      type: "invalid_request_error",
      param: "prompt",
    },
    additional_context: fullContext,
    authorization: "Bearer other-test-credential",
    api_key: testKey,
  });
  try {
    for (const environment of ["development", "production", "test"]) {
      process.env.NODE_ENV = environment;
      let logs = "";
      const sink = new Writable({
        write(chunk, _encoding, done) { logs += chunk.toString(); done(); },
      });
      const app = express();
      app.use(pinoHttp({ logger: pino({ level: "warn" }, sink) }));
      app.use(express.json());
      app.use("/api", createTestImageRouter({
        getApiKey: () => testKey,
        fetcher: async () => new Response(providerBody, { status: 400 }),
      }));
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as { port: number };
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/test-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "A custom image prompt" }),
        });
        assert.equal(response.status, 502, "The existing error HTTP behavior must stay unchanged");
        const body = await response.json() as { error: string; openaiError?: unknown };
        const entries = logs.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const failure = entries.find((entry) => entry.stage === "test_image_failed");
        assert.equal(failure.upstreamStatus, 400);
        if (environment === "development") {
          const expected = {
            status: 400,
            message: "Prompt was rejected. Echoed key: [REDACTED]",
            code: "invalid_image_prompt",
            type: "invalid_request_error",
            param: "prompt",
          };
          assert.deepEqual(body.openaiError, expected);
          assert.deepEqual(failure.openaiError, expected);
          const loggedBody = JSON.parse(failure.openaiResponseBody);
          assert.equal(loggedBody.additional_context, fullContext, "The complete body must not be truncated");
          assert.equal(loggedBody.authorization, "[REDACTED]");
          assert.equal(loggedBody.api_key, "[REDACTED]");
        } else {
          assert.equal(body.openaiError, undefined);
          assert.equal(failure.openaiError, undefined);
          assert.equal(failure.openaiResponseBody, undefined);
          assert.doesNotMatch(logs, /Detailed upstream context/);
        }
        assert.doesNotMatch(logs + JSON.stringify(body), /test-credential-not-real|other-test-credential|Bearer/);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});
