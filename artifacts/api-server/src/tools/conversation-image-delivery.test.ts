import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import { createKindroidProvider } from "@workspace/assistant-providers";
import { SendAssistantMessageResponse } from "@workspace/api-zod";
import { resolveConversationIntent } from "./conversation-intent.js";
import { generateConversationImage } from "./ren-image-prompt.js";
import { dispatchConversationImage, prepareConversationImageDelivery } from "./conversation-image-delivery.js";
import { generatedImageFromMetadata } from "./image-generation.js";
import { resolveOptionalWebSearch, InsufficientNewsEvidenceError } from "./web-search.js";
import { appendSuccessfulConsultation } from "./provider-tool-content.js";
import { suppliedDirectRequests, suppliedOutfitRequests, holdoutRenRequests, ordinaryImageMentions, uploadedPhotoInspection } from "./semantic-image-fixtures.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
const logger = pino({ enabled: false });
const requests = [
  "send me a picture", "can you send a photo?", "show me what you’re wearing",
  "I’d love to see your outfit", "are you ready to show me your outfit for today?",
  "Ok baby. Are you ready to show me your outfit for today?",
  "I’d like you to send me a selfie",
  "I'd like you to send me a selfie.",
  "I would like you to send me a selfie.",
  "Could you send me a photo?",
  "Would you show me a picture?",
  "Show me a picture of yourself",
];
const promise = [
  { role: "user", content: "Show me what you're wearing." },
  { role: "assistant", content: "I'll send a picture so you can coordinate." },
];

test("every labeled and holdout Ren request executes the live shared dispatcher and attaches actual stored PNG bytes", async () => {
  let imageCalls = 0;
  let knCalls = 0;
  const storage = new Map<string, Buffer>();
  const kn = createKindroidProvider({
    apiKey: "test-only-key", aiId: "test-only-ren",
    fetch: async (_url, init) => {
      knCalls++;
      assert.match(JSON.parse(String(init?.body)).message, /generate_image completed successfully/);
      return new Response("I pose for the photo."); // Prose alone cannot pass.
    },
  });
  const corpus = [...suppliedDirectRequests, ...suppliedOutfitRequests, ...holdoutRenRequests];
  for (const content of corpus) {
    const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages: promise });
    assert.ok(intent.imageRequest?.resolvedAssistantSubject, content);
    assert.equal(intent.webSearchRequested, false);
    const delivery = await dispatchConversationImage({
      content, prompt: intent.imageRequest.prompt, messages: promise,
      generation: {
        apiKey: "test-only-key", logger,
        readWardrobe: async () => ({ outfit: "Existing approved black hoodie and lounge pants." }),
        fetcher: async (url, init) => {
          imageCalls++;
          assert.equal(url, "https://api.openai.com/v1/images/edits");
          const payload = JSON.parse(String(init?.body));
          assert.match(payload.prompt, /Existing approved black hoodie/);
          assert.ok(payload.images[0].image_url.startsWith("data:image/png;base64,"));
          return Response.json({ data: [{ b64_json: png.toString("base64") }] });
        },
        save: async bytes => {
          const path = `/objects/generated/abc-${imageCalls}.png`;
          storage.set(path, bytes);
          return path;
        },
      },
      complete: request => kn.complete(request),
    });
    const pair = SendAssistantMessageResponse.parse({
      userMessage: { id: 1, conversationId: 1, role: "user", content, model: null, metadata: null, createdAt: new Date() },
      assistantMessage: { id: 2, conversationId: 1, role: "assistant", content: delivery.content, model: delivery.result.model, metadata: delivery.metadata, createdAt: new Date() },
    });
    const attached = generatedImageFromMetadata(pair.assistantMessage.metadata);
    assert.ok(attached, content);
    assert.deepEqual(storage.get(attached.objectPath), png, content);
    assert.deepEqual(JSON.parse(pair.assistantMessage.metadata!).tools, [{ id: "generate_image", model: delivery.image.model }]);
  }
  assert.equal(imageCalls, corpus.length);
  assert.equal(knCalls, corpus.length);
  assert.equal(storage.size, corpus.length);
  // Same routing gate as the API: ordinary conversation never calls the tool.
  for (const content of [...ordinaryImageMentions, ...uploadedPhotoInspection]) {
    assert.equal(resolveConversationIntent(content, { assistantCharacter: "Ren", messages: promise }).imageRequest, null, content);
  }
});

test("repeat requests dispatch a second actual tool call and attach a NEW stored image, never just narration", async () => {
  for (const content of [
    "Can I have another selfie of you?",
    "Could I have one more selfie of you?",
    "Send me another selfie.",
    "One more selfie.",
    "Another one.",
    "One more.",
    "A different angle.",
    "Send me a selfie from a different angle.",
    "Can I have another selfie of you from a different angle?",
  ]) {
    const messages: Array<{ role: string; content: string; metadata: string | null }> = [];
    const storedImages = new Map<string, Buffer>();
    let imageCalls = 0;
    let knCalls = 0;
    const kn = createKindroidProvider({
      apiKey: "test-only-key", aiId: "test-only-ren",
      fetch: async (_url, init) => {
        knCalls++;
        assert.match(JSON.parse(String(init?.body)).message, /generate_image completed successfully/);
        // Narration alone is NOT the test's success criterion.
        return new Response("I pose for another photo for you.");
      },
    });
    async function dispatch(request: string) {
      const intent = resolveConversationIntent(request, { assistantCharacter: "Ren", messages });
      assert.ok(intent.imageRequest, request);
      assert.equal(intent.webSearchRequested, false);
      const delivery = await dispatchConversationImage({
        content: request, prompt: intent.imageRequest.prompt, messages,
        generation: {
          apiKey: "test-only-key", logger,
          readWardrobe: async () => ({ outfit: "Existing approved black hoodie and lounge pants." }),
          fetcher: async (url, init) => {
            imageCalls++;
            assert.equal(url, "https://api.openai.com/v1/images/edits");
            const payload = JSON.parse(String(init?.body));
            if (/angle/i.test(request)) assert.match(payload.prompt, /different(?: camera)? angle/i);
            return Response.json({ data: [{ b64_json: png.toString("base64") }] });
          },
          save: async bytes => {
            const path = `/objects/generated/abc-${imageCalls}.png`;
            storedImages.set(path, bytes);
            return path;
          },
        },
        complete: modelRequest => kn.complete(modelRequest),
      });
      const pair = SendAssistantMessageResponse.parse({
        userMessage: { id: messages.length + 1, conversationId: 1, role: "user", content: request, model: null, metadata: null, createdAt: new Date() },
        assistantMessage: { id: messages.length + 2, conversationId: 1, role: "assistant", content: delivery.content, model: delivery.result.model, metadata: delivery.metadata, createdAt: new Date() },
      });
      const attached = generatedImageFromMetadata(pair.assistantMessage.metadata);
      assert.ok(attached, "A narrative reply without attachment MUST fail");
      assert.deepEqual(storedImages.get(attached.objectPath), png, "Attachment must resolve to generated PNG bytes");
      assert.deepEqual(JSON.parse(pair.assistantMessage.metadata!).tools, [{ id: "generate_image", model: delivery.image.model }]);
      messages.push(pair.userMessage, pair.assistantMessage);
      return attached;
    }
    const first = await dispatch("Show me a picture of yourself");
    assert.equal(imageCalls, 1);
    const second = await dispatch(content);
    assert.equal(imageCalls, 2, `${content}: completed-image handling must not suppress a fresh tool call`);
    assert.equal(knCalls, 2);
    assert.equal(storedImages.size, 2);
    assert.notEqual(second.objectPath, first.objectPath, "Must not reuse the old attachment");
  }
});

test("regression phrasings generate one attachment through the existing real KN adapter, standalone and in context", async () => {
  for (const messages of [[], promise]) {
    for (const content of [...requests, ...(messages.length ? ["Ready?", "Send it please.", "Yes."] : [])]) {
      const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages });
      assert.ok(intent.imageRequest, content);
      assert.equal(intent.webSearchRequested, false, "Image requests must not call search");
      let generated = 0;
      let stored = 0;
      let knCalls = 0;
      const image = await generateConversationImage(intent.imageRequest.prompt, {
        apiKey: "test-only-key", logger,
        readWardrobe: async () => ({ outfit: "Existing approved black hoodie and lounge pants." }),
        fetcher: async (url, init) => {
          generated++;
          assert.equal(url, "https://api.openai.com/v1/images/edits");
          const payload = JSON.parse(String(init?.body));
          assert.match(payload.prompt, /Existing approved black hoodie/);
          assert.ok(payload.images[0].image_url.startsWith("data:image/png;base64,"));
          return Response.json({ data: [{ b64_json: png.toString("base64") }] });
        },
        save: async bytes => {
          assert.deepEqual(bytes, png);
          stored++;
          return "/objects/generated/abc-123.png";
        },
      });
      const kn = createKindroidProvider({
        apiKey: "test-only-key", aiId: "test-only-ren",
        fetch: async (url, init) => {
          knCalls++;
          assert.equal(url, "https://api.kindroid.ai/v1/send-message");
          const body = JSON.parse(String(init?.body));
          assert.equal(body.ai_id, "test-only-ren");
          assert.ok(body.message.startsWith(content));
          assert.match(body.message, /generate_image completed successfully/);
          assert.doesNotMatch(body.message, /search_unavailable|search failed|fallback|OpenAI consultation failed|HTTP 400|moderation_blocked|INTERNAL_PRIVATE_ERROR/i);
          return new Response("Here is your picture, baby.");
        },
      });
      const delivery = await prepareConversationImageDelivery({
        content, prompt: intent.imageRequest.prompt, image,
        // Legacy diagnostics in local history must not be retransmitted to KN.
        messages: [...messages, { role: "assistant", content: "INTERNAL_PRIVATE_ERROR: fallback HTTP 400" }],
        complete: request => {
          assert.equal(request.requestedProvider, "kindroid");
          return kn.complete(request);
        },
      });
      // Exercise the actual HTTP response schema/attachment contract in memory.
      const now = new Date();
      const pair = SendAssistantMessageResponse.parse({
        userMessage: { id: 1, conversationId: 1, role: "user", content, model: null, metadata: null, createdAt: now },
        assistantMessage: { id: 2, conversationId: 1, role: "assistant", content: delivery.content, model: delivery.result.model, metadata: delivery.metadata, createdAt: now },
      });
      assert.equal(generatedImageFromMetadata(pair.assistantMessage.metadata)?.objectPath, image.objectPath);
      assert.equal(generatedImageFromMetadata(pair.assistantMessage.metadata)?.prompt, image.prompt);
      assert.deepEqual(JSON.parse(pair.assistantMessage.metadata!).tools, [{ id: "generate_image", model: image.model }]);
      assert.equal(delivery.result.providerId, "kindroid");
      assert.equal(generated, 1);
      assert.equal(stored, 1);
      assert.equal(knCalls, 1);
    }
  }
});

test("failed generation never calls KN or turns upstream diagnostics into a message", async () => {
  let knCalls = 0;
  await assert.rejects(dispatchConversationImage({
    content: "send me a picture", prompt: "image of Ren in her current outfit", messages: [],
    generation: {
      apiKey: "test-only-key", logger,
      readWardrobe: async () => ({ outfit: "Existing approved outfit." }),
      fetcher: async () => Response.json({ error: { message: "INTERNAL_PRIVATE_ERROR", code: "denied", type: "provider_error", param: null } }, { status: 403 }),
      save: async () => assert.fail("Rejected images must never be stored"),
    },
    onGenerated: () => assert.fail("Failed generation must not report a stored result"),
    complete: async () => { knCalls++; throw new Error("Should not be called"); },
  }));
  assert.equal(knCalls, 0);
});

test("shared dispatcher preserves cleanup ownership when the KN acknowledgement fails", async () => {
  let cleanupPath: string | undefined;
  await assert.rejects(dispatchConversationImage({
    content: "Send me another selfie.", prompt: "selfie of Ren", messages: [],
    generation: {
      apiKey: "test-only-key", logger,
      readWardrobe: async () => ({ outfit: "Existing approved outfit." }),
      fetcher: async () => Response.json({ data: [{ b64_json: png.toString("base64") }] }),
      save: async () => "/objects/generated/abc-123.png",
    },
    onGenerated: image => { cleanupPath = image.objectPath; },
    complete: async () => {
      assert.equal(cleanupPath, "/objects/generated/abc-123.png", "Route must own cleanup before contacting KN");
      throw new Error("KN transport unavailable");
    },
  }), /KN transport unavailable/);
  assert.equal(cleanupPath, "/objects/generated/abc-123.png");
});

test("KN failures and preview fallbacks remain errors, never successful image deliveries", async () => {
  const image = await generateConversationImage("a crow", {
    apiKey: "test-only-key", logger,
    fetcher: async () => Response.json({ data: [{ b64_json: png.toString("base64") }] }),
    save: async () => "/objects/generated/fixture.png",
  });
  await assert.rejects(prepareConversationImageDelivery({
    content: "Send me a picture.", prompt: image.prompt, image, messages: [],
    complete: async () => ({ providerId: "local-preview", model: "preview", content: "fallback diagnostic", metadata: { mode: "preview", routedBy: "provider-router" } }),
  }), /Ren is unavailable/);
  await assert.rejects(prepareConversationImageDelivery({
    content: "Send me a picture.", prompt: image.prompt, image, messages: [],
    complete: async () => { throw new Error("KN transport unavailable"); },
  }), /KN transport unavailable/);
});

test("web and consultation errors/insufficient-evidence fallbacks never appear in actual KN transport bodies", async () => {
  const content = "What is the news today?";
  for (const error of [new Error("INTERNAL_PRIVATE_ERROR"), new InsufficientNewsEvidenceError()]) {
    const search = await resolveOptionalWebSearch(content, async () => { throw error; });
    assert.equal(search.error, error);
    for (const consultation of [{ requested: false }, { requested: true, status: "failed" }]) {
      const message = appendSuccessfulConsultation(search.providerContent, content, {
        providerContent: `${content}\n\n[OpenAI consultation failed: INTERNAL_PRIVATE_ERROR fallback]`,
        consultation,
      });
      const kn = createKindroidProvider({
        apiKey: "test-only-key", aiId: "test-only-ren",
        fetch: async (_url, init) => {
          assert.equal(JSON.parse(String(init?.body)).message, content);
          return new Response("A conversational reply.");
        },
      });
      await kn.complete({ messages: [{ role: "user", content: message }] });
    }
  }
  const success = appendSuccessfulConsultation(content, content, {
    providerContent: `${content}\n\nVerified factual helper answer`,
    consultation: { requested: true, status: "completed" },
  });
  assert.match(success, /Verified factual helper answer/);
});
