import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import { generate_image, extractImagePrompt, generatedImageFromMetadata } from "./image-generation.js";
import { generateImage, TestImageError } from "../lib/test-image-generation.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
const success = () => Response.json({ data: [{ b64_json: png.toString("base64") }] });
const blocked = (stage: string) => Response.json({
  error: { message: "Safety system rejected output", code: "moderation_blocked", type: "image_generation_user_error", param: null, moderation_details: { moderation_stage: stage } },
}, { status: 400 });

test("explicit image requests dispatch generate_image, ordinary chat does not", () => {
  assert.equal(extractImagePrompt("/image a crow"), "a crow");
  assert.equal(extractImagePrompt("generate_image: a crow"), "a crow");
  assert.equal(extractImagePrompt("Please generate an image of a crow"), "a crow");
  for (const message of ["How does image generation work?", "I made an image yesterday", "Consult OpenAI about image generation", "Hello Ren", "Do not generate an image of a crow"]) {
    assert.equal(extractImagePrompt(message), null);
  }
});

test("output moderation retries once with an identical prompt, then stores one PNG", async () => {
  const prompt = "  Exact prompt, unchanged.  ";
  const prompts: string[] = [];
  let writes = 0;
  const result = await generate_image(prompt, {
    apiKey: "test-only-key", logger: pino({ enabled: false }),
    fetcher: async (_url, init) => {
      prompts.push(JSON.parse(String(init?.body)).prompt);
      return prompts.length === 1 ? blocked("output") : success();
    },
    save: async (bytes) => { writes++; assert.deepEqual(bytes, png); return "/objects/generated/abc-123.png"; },
  });
  assert.deepEqual(prompts, [prompt, prompt]);
  assert.equal(writes, 1);
  assert.equal(result.tool, "generate_image");
  assert.equal(generatedImageFromMetadata(JSON.stringify({ generatedImage: result }))?.objectPath, result.objectPath);
});

test("retry is bounded at two attempts across transient errors and moderation", async () => {
  for (const fail of [
    () => blocked("output"),
    () => new Response("Overloaded", { status: 503 }),
    () => { throw new TypeError("Network unavailable"); },
  ]) {
    let calls = 0;
    await assert.rejects(generateImage("test-key", "fixed prompt", async () => { calls++; return fail(); }), TestImageError);
    assert.equal(calls, 2);
  }
});

test("input moderation and permanent request errors never retry or save", async () => {
  for (const fail of [() => blocked("input"), () => new Response("Invalid parameter", { status: 400 })]) {
    let calls = 0;
    let saved = false;
    await assert.rejects(generate_image("fixed prompt", {
      apiKey: "test-key", logger: pino({ enabled: false }),
      fetcher: async () => { calls++; return fail(); },
      save: async () => { saved = true; return ""; },
    }), TestImageError);
    assert.equal(calls, 1);
    assert.equal(saved, false);
  }
  assert.equal(generatedImageFromMetadata('{"generatedImage":{"prompt":"a crow","objectPath":"/etc/passwd"}}'), null);
});
