import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import pinoHttp from "pino-http";
import pino from "pino";
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
