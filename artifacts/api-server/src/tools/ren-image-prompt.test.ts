import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import pino from "pino";
import { extractImagePrompt } from "./image-generation.js";
import { TEST_IMAGE_MODEL } from "../lib/test-image-generation.js";
import {
  buildRenImagePrompt,
  DEFAULT_REN_OUTFIT,
  depictsRen,
  generateConversationImage,
  REN_CHARACTER_IDENTITY,
} from "./ren-image-prompt.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
const success = () => Response.json({ data: [{ b64_json: png.toString("base64") }] });
const sectionNames = ["characterIdentity", "wardrobe", "scene", "poseAndFraming", "styleAndMood", "userRequestDetails"];

function captureLogs() {
  const events: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).trim().split("\n")) if (line) events.push(JSON.parse(line));
      callback();
    },
  });
  return { events, logger: pino({ timestamp: false }, stream) };
}

test("the three requested examples use the shared image tool with the correct prompt path", async () => {
  const examples = [
    { request: "Generate a selfie of Ren at home.", activated: true, scene: "at home" },
    { request: "Generate an image of Ren reading by a window.", activated: true, scene: "by a window" },
    { request: "Generate an image of a tiny blue robot beside a gold coin.", activated: false },
  ];
  for (const example of examples) {
    const rawPrompt = extractImagePrompt(example.request);
    assert.ok(rawPrompt, `Image dispatcher must recognize ${example.request}`);
    const { logger, events } = captureLogs();
    let wardrobeReads = 0;
    const requests: Array<{ prompt: string; model: string; n: number; output_format: string }> = [];
    let writes = 0;
    const image = await generateConversationImage(rawPrompt, {
      apiKey: "test-key", logger,
      readWardrobe: async () => { wardrobeReads++; return null; },
      fetcher: async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/images/generations");
        requests.push(JSON.parse(String(init?.body)));
        return success();
      },
      save: async (bytes) => { writes++; assert.deepEqual(bytes, png); return "/objects/generated/abc-123.png"; },
    });
    assert.equal(requests.length, 1);
    assert.equal(writes, 1);
    assert.equal(requests[0].model, TEST_IMAGE_MODEL);
    assert.equal(requests[0].n, 1);
    assert.equal(requests[0].output_format, "png");
    assert.equal(image.tool, "generate_image");
    assert.equal(image.prompt, requests[0].prompt);
    const builtEvent = events.find((event) => event.stage === "ren_image_prompt_built");
    assert.equal(!!builtEvent, example.activated);
    assert.equal(wardrobeReads, example.activated ? 1 : 0);
    if (example.activated) {
      assert.deepEqual(builtEvent?.sectionNames, sectionNames);
      assert.equal(builtEvent?.wardrobeSource, "canonical_fallback");
      for (const trait of [
        "adult woman", "distinctly feminine appearance", "petite/slender feminine build",
        "heart-shaped feminine face", "soft feminine jawline", "delicate nose",
        "full feminine lips", "large luminous golden eyes", "long flowing black hair",
        "porcelain-pale skin", "elegant black feather accents", "ornate gold jewelry",
        "dark elegant gothic aesthetic", "feminine styling and silhouette",
      ]) {
        assert.ok(requests[0].prompt.includes(trait));
      }
      assert.match(requests[0].prompt, /Do not render Ren as male, masculine-presenting, bearded, broad-jawed, or as a masculine anime character\./);
      assert.ok(requests[0].prompt.includes(DEFAULT_REN_OUTFIT));
      assert.ok(requests[0].prompt.includes(example.scene!));
      assert.ok(requests[0].prompt.includes(rawPrompt));
      const sections = builtEvent?.sections as Record<string, string>;
      assert.equal(sections.characterIdentity, REN_CHARACTER_IDENTITY);
      assert.ok(sections.scene.includes(example.scene!));
      if (example.request.includes("selfie")) assert.match(sections.poseAndFraming, /arm's-length selfie/);
      else assert.match(sections.poseAndFraming, /reading/);
    } else {
      assert.equal(requests[0].prompt, "a tiny blue robot beside a gold coin.");
      assert.equal(requests[0].prompt, rawPrompt);
      assert.ok(!requests[0].prompt.includes(REN_CHARACTER_IDENTITY));
      assert.ok(events.some((event) => event.stage === "ren_image_prompt_bypassed"));
    }
  }
});

test("wardrobe state and accessories replace the default without altering canonical identity", () => {
  const result = buildRenImagePrompt("Ren reading by a window.", {
    outfit: "A deep violet velvet coat.", accessories: "A gold raven brooch.",
  });
  assert.equal(result.activated, true);
  if (!result.activated) return;
  assert.equal(result.wardrobeSource, "current_state");
  assert.equal(result.sections.characterIdentity, REN_CHARACTER_IDENTITY);
  assert.match(result.sections.wardrobe, /violet velvet coat/);
  assert.match(result.sections.wardrobe, /gold raven brooch/);
  assert.ok(!result.prompt.includes(DEFAULT_REN_OUTFIT));
  assert.match(result.sections.scene, /by a window/);
});

test("missing or empty wardrobe uses the default; non-Ren prompts are byte-for-byte unchanged", () => {
  for (const state of [undefined, null, { outfit: "  " }]) {
    const result = buildRenImagePrompt("Ren at home.", state);
    assert.equal(result.activated, true);
    if (result.activated) {
      assert.equal(result.wardrobeSource, "canonical_fallback");
      assert.equal(result.sections.wardrobe, DEFAULT_REN_OUTFIT);
    }
  }
  const original = "  a tiny blue robot beside a gold coin.\n";
  assert.deepEqual(buildRenImagePrompt(original, { outfit: "Black velvet" }), { activated: false, prompt: original });
});

test("current wardrobe is read afresh for each request, never for non-Ren images", async () => {
  let outfit = "Black velvet coat";
  let reads = 0;
  const options = {
    apiKey: "test-key", logger: pino({ enabled: false }),
    readWardrobe: async () => { reads++; return { outfit }; },
    fetcher: async () => success(),
    save: async () => "/objects/generated/abc-123.png",
  };
  const first = await generateConversationImage("Ren at home.", options);
  outfit = "Dark emerald dress";
  const second = await generateConversationImage("Ren at home.", options);
  const robot = await generateConversationImage("A tiny blue robot", options);
  assert.ok(first.prompt.includes("Black velvet coat"));
  assert.ok(second.prompt.includes("Dark emerald dress"));
  assert.ok(!second.prompt.includes("Black velvet coat"));
  assert.equal(robot.prompt, "A tiny blue robot");
  assert.equal(reads, 2);
});

test("retry receives the identical canonical prompt and does not rebuild or reread wardrobe", async () => {
  const { logger, events } = captureLogs();
  const prompts: string[] = [];
  let wardrobeReads = 0;
  await generateConversationImage("selfie of Ren at home.", {
    apiKey: "test-key", logger,
    readWardrobe: async () => { wardrobeReads++; return { outfit: "A black satin blouse." }; },
    fetcher: async (_url, init) => {
      prompts.push(JSON.parse(String(init?.body)).prompt);
      return prompts.length === 1 ? new Response("Overloaded", { status: 503 }) : success();
    },
    save: async () => "/objects/generated/abc-123.png",
  });
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.equal(wardrobeReads, 1);
  assert.equal(events.filter((event) => event.stage === "ren_image_prompt_built").length, 1);
});

test("Ren detection avoids substrings, negative references, text labels, and style-only requests", () => {
  for (const prompt of ["Render a robot", "A portrait of René", "A forest without Ren", "The word 'Ren' on a coin", "A robot in Ren's style"]) {
    assert.equal(depictsRen(prompt), false, prompt);
  }
  for (const prompt of ["Ren reading", "Selfie of ren at home", "Ren's selfie", "A robot beside Ren"]) {
    assert.equal(depictsRen(prompt), true, prompt);
  }
  assert.equal(extractImagePrompt("Generate a Ren selfie at home."), "selfie of Ren at home.");
  assert.equal(extractImagePrompt("Generate a Ren selfie."), "selfie of Ren");
  assert.equal(extractImagePrompt("How do I create Ren selfies?"), null);
});

test("builder logs structured sections while redacting credential-like request details", async () => {
  const { logger, events } = captureLogs();
  await generateConversationImage("Ren at home api_key=pretend-value and sk-fakecredential.", {
    apiKey: "test-key", logger, fetcher: async () => success(),
    save: async () => "/objects/generated/abc-123.png",
  });
  const log = JSON.stringify(events.find((event) => event.stage === "ren_image_prompt_built"));
  assert.ok(log.includes("characterIdentity"));
  assert.ok(log.includes("[REDACTED]"));
  assert.ok(!log.includes("pretend-value"));
  assert.ok(!log.includes("sk-fakecredential"));
});
