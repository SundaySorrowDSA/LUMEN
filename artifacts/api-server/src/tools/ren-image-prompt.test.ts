import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import pino from "pino";
import { extractImagePrompt } from "./image-generation.js";
import { TEST_IMAGE_MODEL } from "../lib/test-image-generation.js";
import { loadRenVisualReference } from "../lib/ren-visual-reference.js";
import { REN_VISUAL_REFERENCE } from "../config/ren-visual-reference.js";
import {
  buildRenImagePrompt,
  DEFAULT_REN_OUTFIT,
  depictsRen,
  generateConversationImage,
  REN_CHARACTER_IDENTITY,
  REN_REFERENCE_IDENTITY_INSTRUCTION,
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
  const canonicalReference = await loadRenVisualReference();
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
    const requests: Array<{ prompt: string; model: string; n: number; output_format: string; images?: Array<{ image_url: string }> }> = [];
    let writes = 0;
    const image = await generateConversationImage(rawPrompt, {
      apiKey: "test-key", logger,
      readWardrobe: async () => { wardrobeReads++; return null; },
      fetcher: async (url, init) => {
        assert.equal(url, example.activated
          ? "https://api.openai.com/v1/images/edits"
          : "https://api.openai.com/v1/images/generations");
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
      assert.equal(requests[0].images?.length, 1);
      const referenceUrl = requests[0].images![0].image_url;
      assert.ok(referenceUrl.startsWith("data:image/png;base64,"));
      assert.deepEqual(Buffer.from(referenceUrl.split(",")[1], "base64"), canonicalReference);
      assert.ok(requests[0].prompt.includes(REN_REFERENCE_IDENTITY_INSTRUCTION));
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
      assert.equal(requests[0].images, undefined);
      assert.equal(requests[0].prompt, "a tiny blue robot beside a gold coin.");
      assert.equal(requests[0].prompt, rawPrompt);
      assert.ok(!requests[0].prompt.includes(REN_CHARACTER_IDENTITY));
      assert.ok(events.some((event) => event.stage === "ren_image_prompt_bypassed"));
    }
  }
});

test("Ren receives a conditional secondary hair-feather cue without changing identity or non-Ren prompts", () => {
  for (const prompt of ["Ren at home.", "Ren wearing a plain hoodie without feathers or hair accessories outdoors."]) {
    const result = buildRenImagePrompt(prompt);
    assert.equal(result.activated, true);
    if (!result.activated) continue;
    assert.equal(result.sections.characterIdentity, REN_CHARACTER_IDENTITY);
    assert.match(result.prompt, /Include subtle, natural black feather adornments in Ren's hair by default unless the current scene or wardrobe explicitly calls for otherwise\./);
    assert.match(result.prompt, /Feathers are a secondary Ren marker, not part of her facial identity; the canonical face remains the highest-priority identity reference\./);
    assert.match(result.prompt, /Do not create oversized feather crowns, elaborate headdresses, or excessive fantasy ornamentation, or increase jewelry or outfit complexity\./);
    assert.match(result.prompt, /Clothing, pose, background, and activity remain variable\./);
    assert.equal(result.sections.userRequestDetails, prompt);
    assert.match(result.prompt, /Honor explicit scene, pose, framing, style, and wardrobe changes in the user-specific request/);
  }
  const nonRen = "A tiny blue robot beside a gold coin.";
  assert.deepEqual(buildRenImagePrompt(nonRen), { activated: false, prompt: nonRen });
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
  assert.ok(result.prompt.includes(REN_REFERENCE_IDENTITY_INSTRUCTION));
  assert.match(result.prompt, /Do not copy clothing, pose, background, expression, jewelry, accessories, or feather arrangement/);
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
  const payloads: Array<{ prompt: string; images?: Array<{ image_url: string }> }> = [];
  const options = {
    apiKey: "test-key", logger: pino({ enabled: false }),
    readWardrobe: async () => { reads++; return { outfit }; },
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)));
      return success();
    },
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
  assert.deepEqual(payloads[0].images, payloads[1].images);
  assert.equal(payloads[2].images, undefined);
});

test("retry receives the identical canonical prompt and does not rebuild or reread wardrobe", async () => {
  const { logger, events } = captureLogs();
  const prompts: string[] = [];
  const bodies: string[] = [];
  let wardrobeReads = 0;
  let referenceReads = 0;
  await generateConversationImage("selfie of Ren at home.", {
    apiKey: "test-key", logger,
    readWardrobe: async () => { wardrobeReads++; return { outfit: "A black satin blouse." }; },
    readReferenceAsset: async (path) => {
      referenceReads++;
      assert.ok(path.endsWith(REN_VISUAL_REFERENCE.assetPath));
      return loadRenVisualReference();
    },
    fetcher: async (_url, init) => {
      prompts.push(JSON.parse(String(init?.body)).prompt);
      bodies.push(String(init?.body));
      return prompts.length === 1 ? new Response("Overloaded", { status: 503 }) : success();
    },
    save: async () => "/objects/generated/abc-123.png",
  });
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.equal(wardrobeReads, 1);
  assert.equal(referenceReads, 1);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(events.filter((event) => event.stage === "ren_image_prompt_built").length, 1);
});

test("missing and unreadable Ren reference assets fail before provider calls or persistence", async () => {
  for (const code of ["ENOENT", "EACCES"]) {
    let calls = 0;
    let saves = 0;
    await assert.rejects(generateConversationImage("Ren at home.", {
      apiKey: "test-key", logger: pino({ enabled: false }),
      readReferenceAsset: async () => { throw Object.assign(new Error("Fixture filesystem error"), { code }); },
      fetcher: async () => { calls++; return success(); },
      save: async () => { saves++; return "/objects/generated/abc-123.png"; },
    }), /approved canonical face reference \(v1\) is missing or unreadable.*No image was generated/);
    assert.equal(calls, 0);
    assert.equal(saves, 0);
  }
});

test("an invalid reference asset fails explicitly without generating an unanchored Ren", async () => {
  await assert.rejects(generateConversationImage("Selfie of Ren.", {
    apiKey: "test-key", logger: pino({ enabled: false }),
    readReferenceAsset: async () => Buffer.from("not a PNG"),
    fetcher: async () => { assert.fail("Provider must not be called"); },
  }), /canonical face reference is not a valid PNG/);
});

test("non-Ren requests never load the canonical asset, even when it is unavailable", async () => {
  const result = await generateConversationImage("A tiny blue robot beside a gold coin.", {
    apiKey: "test-key", logger: pino({ enabled: false }),
    readReferenceAsset: async () => { assert.fail("Non-Ren requests must not load Ren's asset"); },
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/images/generations");
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(request, {
        model: TEST_IMAGE_MODEL, prompt: "A tiny blue robot beside a gold coin.", n: 1, output_format: "png",
      });
      return success();
    },
    save: async () => "/objects/generated/abc-123.png",
  });
  assert.equal(result.prompt, "A tiny blue robot beside a gold coin.");
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
