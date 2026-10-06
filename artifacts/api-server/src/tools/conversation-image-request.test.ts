import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import test from "node:test";
import pino from "pino";
import { extractImagePrompt } from "./image-generation.js";
import { resolveConversationImageRequest } from "./conversation-image-request.js";
import { buildRenImagePrompt, generateConversationImage, REN_CHARACTER_IDENTITY, REN_REFERENCE_IDENTITY_INSTRUCTION } from "./ren-image-prompt.js";
import { loadRenVisualReference } from "../lib/ren-visual-reference.js";
import { selectRenWardrobe, wardrobePrompt } from "./ren-wardrobe-selector.js";

const original = "Generate a selfie showing me what you’re wearing right now.";
const renRequests = [
  original,
  "Show me what you’re wearing.",
  "Send me a selfie.",
  "Take a picture of yourself.",
  "Let me see you.",
  "Generate a portrait of you looking at me.",
  "Please generate an image of you at home.",
  "Show me what you are wearing in the kitchen.",
  "Generate a selfie showing me what you're wearing right now.",
];
const genericRequests = [
  "generate a castle",
  "show me a crow",
  "make an image of Vampire Hunter D",
  "Generate a selfie of me.",
  "Send me a selfie of myself.",
  "Generate a selfie showing me reading in my bedroom.",
  "Generate an image of a crow looking at you.",
  "Generate an image of Vampire Hunter D wearing your hoodie.",
  "Generate an image of the word you.",
];

test("extraction preserves showing versus of and does not make the viewer the subject", () => {
  assert.equal(extractImagePrompt(original), "selfie showing me what you’re wearing right now.");
  assert.equal(extractImagePrompt("Generate a selfie of me."), "selfie of me.");
  assert.equal(extractImagePrompt("Generate a selfie showing me reading."), "selfie showing me reading.");
});

test("assistant image references resolve to Ren, but first-person and named subjects do not", () => {
  for (const request of renRequests) {
    const result = resolveConversationImageRequest(request, { assistantCharacter: "Ren" });
    assert.ok(result, request);
    assert.equal(result.resolvedAssistantSubject, true, request);
    assert.match(result.prompt, /\bRen\b/, request);
    assert.ok(!result.prompt.includes("selfie of me what"), request);
  }
  assert.equal(resolveConversationImageRequest(original, { assistantCharacter: "Ren" })?.prompt,
    "selfie of Ren showing the viewer her current outfit right now.");
  assert.equal(resolveConversationImageRequest("Generate a portrait of you looking at me.", { assistantCharacter: "Ren" })?.prompt,
    "portrait of Ren looking at me.");
  for (const request of genericRequests) {
    const result = resolveConversationImageRequest(request, { assistantCharacter: "Ren" });
    assert.ok(result, request);
    assert.equal(result.resolvedAssistantSubject, false, request);
    assert.equal(result.prompt, extractImagePrompt(request), request);
  }
});

test("assistant resolution requires Ren context, and ordinary chat stays ordinary", () => {
  assert.equal(resolveConversationImageRequest(original, { assistantCharacter: null })?.prompt,
    extractImagePrompt(original));
  for (const request of ["Show me what you’re wearing.", "Let me see you."]) {
    assert.equal(resolveConversationImageRequest(request, { assistantCharacter: null }), null);
  }
  for (const request of ["Show me your schedule.", "Let me see your code.", "Generate a plan.", "Send me the report.", "How can I generate a selfie?", "Do not send me a selfie."]) {
    assert.equal(resolveConversationImageRequest(request, { assistantCharacter: "Ren" }), null, request);
  }
});

test("explicit tool subjects take precedence; assistant and user roles stay distinct", () => {
  assert.equal(resolveConversationImageRequest(original, {
    assistantCharacter: "Ren", toolPrompt: "a crow",
  })?.prompt, "a crow");
  assert.equal(resolveConversationImageRequest("", {
    assistantCharacter: "Ren", toolPrompt: "selfie of you looking at me",
  })?.prompt, "selfie of Ren looking at me");
  assert.equal(resolveConversationImageRequest("", {
    assistantCharacter: "Ren", toolPrompt: "selfie of myself",
  })?.resolvedAssistantSubject, false);
});

test("asking what Ren is wearing reuses her existing approved outfit without a clothing-change instruction", () => {
  const now = new Date("2026-10-06T14:00:00Z");
  const current = selectRenWardrobe({ prompt: "Ren relaxing at home in a black hoodie and lounge pants.", now }, null);
  for (const request of [original, "Show me what you’re wearing."]) {
    const resolved = resolveConversationImageRequest(request, { assistantCharacter: "Ren" });
    assert.ok(resolved);
    const next = selectRenWardrobe({ prompt: resolved.prompt, now }, current);
    assert.deepEqual(next, current);
    assert.deepEqual(wardrobePrompt(next), wardrobePrompt(current));
  }
});

test("original selfie request keeps subject, identity, reference instructions, and at_home selection unchanged with covered base_layer", () => {
  // Pin the approved identity/reference text independently of the renderer.
  assert.equal(createHash("sha256").update(REN_CHARACTER_IDENTITY).digest("hex"),
    "bd413c37ea9d6d9769c9695b20ac1c667a70e9e6c713b5cc11ad019d7b234955");
  assert.equal(createHash("sha256").update(REN_REFERENCE_IDENTITY_INSTRUCTION).digest("hex"),
    "9fe1946913b80f84944f789eacf1a94bc2a7a338edac38991b7b8792a7ba18e9");
  const now = new Date("2026-10-06T04:30:00Z");
  const current = selectRenWardrobe({ prompt: "Ren at home in the evening.", now }, null);
  const resolved = resolveConversationImageRequest(original, { assistantCharacter: "Ren" });
  assert.deepEqual(resolved, {
    prompt: "selfie of Ren showing the viewer her current outfit right now.",
    resolvedAssistantSubject: true, reason: "current_outfit",
  });
  const next = selectRenWardrobe({ prompt: resolved!.prompt, now }, current);
  assert.deepEqual(next, current);
  const built = buildRenImagePrompt(resolved!.prompt, wardrobePrompt(next));
  assert.ok(built.activated);
  assert.equal(built.sections.characterIdentity, REN_CHARACTER_IDENTITY);
  assert.ok(built.prompt.includes(REN_REFERENCE_IDENTITY_INSTRUCTION));
  assert.match(built.sections.wardrobe, /opaque black garment providing full torso and hip coverage/);
  assert.match(built.sections.wardrobe, /Sheer black at-home robe/);
  assert.doesNotMatch(built.prompt, /lingerie|burlesque/i);
  assert.equal(built.sections.userRequestDetails, resolved!.prompt);
});

test("resolved requests reach the existing Ren assembler, reference, and provider; others remain generic", async () => {
  const reference = await loadRenVisualReference();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
  for (const [requests, ren] of [[renRequests, true], [genericRequests, false]] as const) {
    for (const request of requests) {
      const resolved = resolveConversationImageRequest(request, { assistantCharacter: "Ren" });
      assert.ok(resolved);
      const events: Array<Record<string, unknown>> = [];
      const logger = pino({ timestamp: false }, new Writable({
        write(chunk, _encoding, callback) {
          String(chunk).trim().split("\n").forEach(line => events.push(JSON.parse(line)));
          callback();
        },
      }));
      let reads = 0;
      let calls = 0;
      const wardrobe = "An approved current black lounge outfit with gold jewelry.";
      const image = await generateConversationImage(resolved.prompt, {
        apiKey: "test-key", logger,
        readWardrobe: async () => { reads++; return { outfit: wardrobe }; },
        fetcher: async (url, init) => {
          calls++;
          const payload = JSON.parse(String(init?.body));
          assert.equal(url, `https://api.openai.com/v1/images/${ren ? "edits" : "generations"}`);
          assert.equal(payload.prompt.includes(REN_CHARACTER_IDENTITY), ren, request);
          assert.equal(payload.prompt.includes(wardrobe), ren, request);
          assert.equal(Boolean(payload.images), ren, request);
          if (ren) assert.equal(payload.images[0].image_url, `data:image/png;base64,${reference.toString("base64")}`);
          else assert.equal(payload.prompt, resolved.prompt);
          return Response.json({ data: [{ b64_json: png.toString("base64") }] });
        },
        save: async () => "/objects/generated/abc-123.png",
      });
      assert.equal(reads, ren ? 1 : 0, request);
      assert.equal(calls, 1, request);
      assert.equal(image.prompt.includes(REN_CHARACTER_IDENTITY), ren, request);
      assert.equal(events.some(e => e.stage === "ren_image_prompt_built"), ren, request);
      assert.equal(events.some(e => e.stage === "ren_image_prompt_bypassed"), !ren, request);
      if (ren) assert.equal(events.find(e => e.stage === "ren_image_prompt_built")?.wardrobeSource, "current_state");
    }
  }
});
