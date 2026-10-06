import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import { REN_WARDROBE_MANIFEST as manifest } from "../config/ren-wardrobe.js";
import { loadRenVisualReference } from "../lib/ren-visual-reference.js";
import { generateConversationImage } from "./ren-image-prompt.js";
import { getOrSelectCurrentRenWardrobe, type WardrobeStore } from "./ren-wardrobe-state.js";
import { isRenClothingChoice, selectRenWardrobe, validateRenWardrobeState, wardrobePrompt, type PersistedRenWardrobe } from "./ren-wardrobe-selector.js";

const day = new Date("2026-10-05T14:00:00Z");
const later = new Date("2026-10-05T14:01:00Z");
const choose = (prompt: string, current: PersistedRenWardrobe | null = null, now = day) =>
  selectRenWardrobe({ prompt, now }, current);

function fixtureStore(initial?: string) {
  let content = initial;
  let writes = 0;
  let lock = Promise.resolve();
  const store: WardrobeStore = {
    transaction: async (run) => {
      const prior = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => { release = resolve; });
      await prior;
      try {
        return await run({
          read: async () => content === undefined ? undefined : { id: 1, content },
          write: async (state) => { content = JSON.stringify(state); writes++; },
        });
      } finally { release(); }
    },
  };
  return { store, state: () => JSON.parse(content!) as PersistedRenWardrobe, writes: () => writes };
}

test("one approved outfit is selected deterministically for home, out, kitchen, evening, and casual contexts", () => {
  for (const [prompt, expected] of [
    ["Ren at home during daytime.", "casual_home"],
    ["Ren outside on errands.", "daytime_out"],
    ["Ren helping in the kitchen.", "kitchen_helping"],
    ["Ren relaxing at home in the evening.", "at_home"],
    ["Ren lounging casually on the sofa.", "casual_home"],
  ]) {
    const state = choose(prompt);
    assert.equal(state.outfitId, expected);
    assert.ok(state.outfitId in manifest.outfits);
    validateRenWardrobeState(state);
    assert.ok(state.selectedRequiredPieces.every(({ pieceId }) => pieceId in manifest.pieces));
    assert.equal(state.selectedAt, day.toISOString());
    assert.equal(state.selectedDate, "2026-10-05");
    assert.deepEqual(state, choose(prompt));
  }
});

test("same or ambiguous contexts reuse saved clothing and original selection timestamp", () => {
  const state = choose("Ren wearing a black tube top and lounge shorts at home.");
  const next = choose("Ren reading by a window.", state, later);
  assert.equal(next.outfitId, state.outfitId);
  assert.deepEqual(next.selectedRequiredPieces, state.selectedRequiredPieces);
  assert.equal(next.selectedAt, state.selectedAt);
  assert.equal(choose("Ren portrait.", next, later), next);
});

test("clear context changes select a new valid outfit, with safe kitchen base clothing", () => {
  const home = choose("Ren at home.");
  const outside = choose("Ren outside running errands.", home, later);
  assert.equal(outside.outfitId, "daytime_out");
  assert.equal(outside.reason.trigger, "context_change");
  const kitchen = choose("Ren cooking at home.", outside, new Date("2026-10-05T15:00Z"));
  assert.equal(kitchen.outfitId, "kitchen_helping");
  assert.deepEqual(kitchen.basePieces.map((piece) => piece.pieceId), ["black_fitted_tee_tank", "black_hoodie_jacket", "black_cargo_pants"]);
  validateRenWardrobeState(kitchen);
  const relaxed = choose("Ren finished cooking and relaxing on the couch.", kitchen, new Date("2026-10-05T16:00Z"));
  assert.equal(relaxed.outfitId, "casual_home");
  const robe = choose("Ren at home in the evening.");
  const practical = choose("Ren cooking.", robe, later);
  assert.ok(practical.basePieces.every(({ pieceId }) => !["celestial_robe", "black_base_layer"].includes(pieceId)));
  validateRenWardrobeState(practical);
});

test("explicit approved outfit requests override automatic context and preserve requested alternatives", () => {
  const outside = choose("Ren on errands.");
  const explicit = choose("Ren wearing a black tube top and lounge shorts outdoors.", outside, later);
  assert.equal(explicit.outfitId, "casual_home");
  assert.equal(explicit.reason.trigger, "user_request");
  assert.ok(explicit.selectedRequiredPieces.some(({ pieceId }) => pieceId === "black_tube_top"));
  assert.ok(explicit.selectedRequiredPieces.some(({ variant }) => variant === "shorts"));
  const reaffirmed = choose("Ren wearing a black tube top.", explicit, new Date("2026-10-05T14:02Z"));
  assert.equal(reaffirmed.selectedAt, explicit.selectedAt);
  assert.deepEqual(reaffirmed.selectedRequiredPieces, explicit.selectedRequiredPieces);
  const preset = choose("Ren wearing at_home.", outside, later);
  assert.equal(preset.outfitId, "at_home");
});

test("approved optional hoodie is selected only when requested and survives subsequent requests", () => {
  const hoodie = choose("Ren wearing a black hoodie at home.");
  assert.ok(hoodie.selectedOptionalPieces.some(({ pieceId }) => pieceId === "black_hoodie_jacket"));
  const next = choose("Ren lounging at home.", hoodie, later);
  assert.deepEqual(next.selectedOptionalPieces, hoodie.selectedOptionalPieces);
  assert.equal(next.selectedAt, hoodie.selectedAt);
  const plain = choose("Ren wearing a fitted tee without hoodie.", next, later);
  assert.ok(!plain.selectedOptionalPieces.some(({ pieceId }) => pieceId === "black_hoodie_jacket"));
});

test("explicit feather omission is persisted without changing facial identity", () => {
  const state = choose("Ren wearing a fitted tee without feathers.");
  assert.ok(state.omittedPieces.includes("black_feather_hair_adornments"));
  assert.ok(!state.selectedRequiredPieces.some(({ pieceId }) => pieceId === "black_feather_hair_adornments"));
  assert.match(wardrobePrompt(state).outfit, /Do not include subtle black feather hair adornments/);
  const next = choose("Ren portrait.", state, later);
  assert.deepEqual(next.omittedPieces, state.omittedPieces);
  validateRenWardrobeState(next);
});

test("fresh local day selection is appropriate in the morning, not a midnight random clothing reset", () => {
  const state = choose("Ren at home.");
  const midnight = choose("Ren portrait.", state, new Date("2026-10-06T04:05Z"));
  assert.equal(midnight.selectedAt, state.selectedAt);
  const morning = choose("Ren portrait.", midnight, new Date("2026-10-06T14:00Z"));
  assert.equal(morning.reason.trigger, "new_day");
  assert.equal(morning.selectedDate, "2026-10-06");
  validateRenWardrobeState(morning);
});

test("Ren's explicit current choice is consumed once and user requests take priority", () => {
  const current = choose("Ren at home.");
  const renChoice = { id: 41, content: "I'm changing into my black hoodie.", createdAt: "2026-10-05T14:00:30Z" };
  const next = selectRenWardrobe({ prompt: "Ren portrait.", now: later, renChoice }, current);
  assert.equal(next.reason.trigger, "ren_choice");
  assert.equal(next.lastRenChoiceMessageId, 41);
  assert.ok(next.selectedOptionalPieces.some(({ pieceId }) => pieceId === "black_hoodie_jacket"));
  const again = selectRenWardrobe({ prompt: "Ren portrait.", now: later, renChoice }, next);
  assert.deepEqual(again, next);
  const user = selectRenWardrobe({ prompt: "Ren wearing a celestial robe.", now: later, renChoice }, current);
  assert.equal(user.outfitId, "at_home");
  assert.equal(user.reason.trigger, "user_request");
  assert.equal(isRenClothingChoice("Maybe I'll change into a robe tomorrow."), false);
});

test("recent user context can inform selection but stale or future history cannot force a change", () => {
  const initial = selectRenWardrobe({
    prompt: "Ren portrait.", now: day,
    recentUserMessages: [{ id: 1, content: "We're outside on errands.", createdAt: "2026-10-05T13:00Z" }],
  }, null);
  assert.equal(initial.outfitId, "daytime_out");
  const unchanged = selectRenWardrobe({
    prompt: "Ren portrait.", now: later,
    recentUserMessages: [
      { id: 2, content: "At home.", createdAt: "2026-10-03T13:00Z" },
      { id: 3, content: "Cooking at home.", createdAt: "2026-10-06T13:00Z" },
    ],
  }, initial);
  assert.deepEqual(unchanged, initial);
});

test("structured storage is reused across separate selector invocations and simultaneous requests", async () => {
  const fixture = fixtureStore();
  await Promise.all(Array.from({ length: 3 }, () =>
    getOrSelectCurrentRenWardrobe({ prompt: "Ren at home.", now: day }, fixture.store)));
  assert.equal(fixture.writes(), 1);
  const state = fixture.state();
  const restored = fixtureStore(JSON.stringify(state));
  await getOrSelectCurrentRenWardrobe({ prompt: "Ren portrait.", now: later }, restored.store);
  assert.equal(restored.writes(), 0);
  assert.deepEqual(restored.state(), state);
});

test("mocked repeated image requests reuse stored outfit and send only the unchanged canonical reference", async () => {
  const fixture = fixtureStore();
  const canonical = await loadRenVisualReference();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
  const prompts: string[] = [];
  let reads = 0;
  for (let index = 0; index < 2; index++) {
    await generateConversationImage("Ren at home.", {
      apiKey: "mock-key", logger: pino({ enabled: false }),
      readWardrobe: () => {
        reads++;
        return getOrSelectCurrentRenWardrobe({ prompt: "Ren at home.", now: index ? later : day }, fixture.store);
      },
      fetcher: async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/images/edits");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.images.length, 1);
        assert.deepEqual(Buffer.from(payload.images[0].image_url.split(",")[1], "base64"), canonical);
        prompts.push(payload.prompt);
        return Response.json({ data: [{ b64_json: png.toString("base64") }] });
      },
      save: async () => "/objects/generated/mock.png",
    });
  }
  assert.equal(reads, 2);
  assert.equal(fixture.writes(), 1);
  assert.equal(prompts[0], prompts[1]);
  for (const exclusion of manifest.exclusions) assert.ok(prompts[0].includes(exclusion.rule));
});

test("non-Ren images bypass all outfit selection and preserve the exact generation payload", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
  await generateConversationImage("A tiny blue robot.", {
    apiKey: "mock-key", logger: pino({ enabled: false }),
    readWardrobe: async () => { assert.fail("Non-Ren request must not select or write wardrobe"); },
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/images/generations");
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.prompt, "A tiny blue robot.");
      assert.equal(payload.images, undefined);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    },
    save: async () => "/objects/generated/mock.png",
  });
});

test("invalid clothing, corrupt saved state, and database failure stop before any image provider call", async () => {
  assert.throws(() => choose("Ren wearing a red dress."), /outside Ren's approved/);
  const bad = fixtureStore("{bad json");
  await assert.rejects(getOrSelectCurrentRenWardrobe({ prompt: "Ren at home.", now: day }, bad.store), /JSON is invalid/);
  assert.equal(bad.writes(), 0);
  const state = choose("Ren at home.");
  state.selectedRequiredPieces.push({ pieceId: "celestial_robe" });
  assert.throws(() => validateRenWardrobeState(state), /combines invalid/);
  const unavailable: WardrobeStore = { transaction: async () => { throw new Error("database unavailable"); } };
  await assert.rejects(generateConversationImage("Ren at home.", {
    apiKey: "mock-key", logger: pino({ enabled: false }),
    readWardrobe: () => getOrSelectCurrentRenWardrobe({ prompt: "Ren at home.", now: day }, unavailable),
    fetcher: async () => { assert.fail("No provider call when state cannot be stored"); },
  }), /could not be loaded or saved/);
});

test("recognized legacy wardrobe memory is converted without interpreting unapproved free text as new pieces", async () => {
  const legacy = fixtureStore("A black hoodie at home.");
  await getOrSelectCurrentRenWardrobe({ prompt: "Ren portrait.", now: day }, legacy.store);
  assert.equal(legacy.writes(), 1);
  assert.equal(legacy.state().outfitId, "casual_home");
  const unsupported = fixtureStore("A violet velvet coat.");
  await assert.rejects(getOrSelectCurrentRenWardrobe({ prompt: "Ren portrait.", now: day }, unsupported.store), /does not match the approved/);
  assert.equal(unsupported.writes(), 0);
});

test("preset-specific variants and minimal kitchen/casual jewelry remain enforced", () => {
  const casual = choose("Ren wearing casual_home with restrained layered jewelry.");
  assert.equal(casual.selectedOptionalPieces.find(({ pieceId }) => pieceId === "gold_black_jewelry")?.variant, "minimal");
  validateRenWardrobeState(casual);
  const top = casual.selectedRequiredPieces.find(({ pieceId }) => pieceId === "black_fitted_tee_tank")!;
  top.variant = "fitted_tank";
  assert.throws(() => validateRenWardrobeState(casual), /combines invalid/);
  const jacket = choose("Ren wearing a black jacket at home.");
  assert.equal(jacket.outfitId, "daytime_out");
  assert.equal(jacket.selectedRequiredPieces.find(({ pieceId }) => pieceId === "black_hoodie_jacket")?.variant, "jacket");
});

test("rendered outfit describes only the chosen clothing variants, not a fresh choice", () => {
  const home = wardrobePrompt(choose("Ren at home in the evening.")).outfit;
  assert.ok(!home.includes("lingerie or"));
  assert.ok(!home.includes("Choose one"));
  const casual = wardrobePrompt(choose("Ren wearing a black tube top and shorts.")).outfit;
  assert.ok(!casual.includes("lounge pants or shorts"));
  assert.ok(!casual.includes("tube top OR"));
  const outside = wardrobePrompt(choose("Ren outside.")).outfit;
  assert.ok(!outside.includes("hoodie or jacket"));
  assert.ok(!outside.includes("combat or platform"));
});

test("at_home base_layer rendering makes coverage explicit while preserving the sheer robe and structured selection", () => {
  const state = choose("Ren at home in the evening.");
  const before = structuredClone(state);
  const outfit = wardrobePrompt(state).outfit;
  assert.equal(state.outfitId, "at_home");
  assert.ok(state.selectedRequiredPieces.some(piece => piece.pieceId === "black_base_layer" && piece.variant === "base_layer"));
  assert.match(outfit, /opaque black garment providing full torso and hip coverage/);
  assert.match(outfit, /The celestial robe remains worn over it/);
  assert.match(outfit, /Presentation is relaxed and neutral/);
  assert.ok(outfit.includes(manifest.pieces.celestial_robe.description));
  assert.match(outfit, /Keep the selected garments fully covering/);
  assert.doesNotMatch(outfit, /lingerie|burlesque/i);
  assert.deepEqual(state, before, "Rendering must not change pieces, family, or selection metadata");
  for (const [id, family] of Object.entries(manifest.outfits)) {
    if (id !== "at_home") assert.ok(!outfit.includes(`Selected approved outfit: ${family.label}.`));
  }
});

test("coverage clarification is confined to at_home base_layer; other variants and families keep their rendering rules", () => {
  for (const request of ["Ren outside.", "Ren cooking.", "Ren lounging casually.", "Ren wearing lingerie at home."]) {
    const state = choose(request);
    const outfit = wardrobePrompt(state).outfit;
    assert.doesNotMatch(outfit, /opaque black garment providing full torso and hip coverage/);
    for (const exclusion of manifest.exclusions) assert.ok(outfit.includes(exclusion.rule));
    if (state.outfitId === "at_home") {
      assert.ok(state.selectedRequiredPieces.some(piece => piece.pieceId === "black_base_layer" && piece.variant === "lingerie"));
      assert.ok(outfit.includes(manifest.pieces.celestial_robe.description));
    }
  }
});

test("old Ren clothing choices cannot undo a newer user selection", () => {
  const current = choose("Ren wearing a celestial robe.");
  const state = selectRenWardrobe({
    prompt: "Ren portrait.", now: later,
    renChoice: { id: 99, content: "I'm changing into my black hoodie.", createdAt: "2026-10-05T13:00Z" },
  }, current);
  assert.deepEqual(state, current);
});
