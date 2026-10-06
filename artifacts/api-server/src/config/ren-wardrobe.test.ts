import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REN_LOOKBOOK_REFERENCE, REN_VISUAL_REFERENCE, REN_WARDROBE_REFERENCE } from "./ren-visual-reference.js";
import { REN_WARDROBE_MANIFEST, REN_WARDROBE_OUTFITS, type RenWardrobeOutfit, type RenWardrobePieceOption } from "./ren-wardrobe.js";
import { loadRenVisualReference } from "../lib/ren-visual-reference.js";

test("wardrobe registration has approved paper-doll metadata without face authority or automatic provider input", () => {
  assert.equal(REN_WARDROBE_REFERENCE.character, "Ren");
  assert.equal(REN_WARDROBE_REFERENCE.role, "wardrobe_reference");
  assert.equal(REN_WARDROBE_REFERENCE.status, "approved");
  assert.equal(REN_WARDROBE_REFERENCE.faceAuthority, "none");
  assert.equal(REN_WARDROBE_REFERENCE.wardrobePriority, "high");
  assert.equal(REN_WARDROBE_REFERENCE.accessoryPriority, "high");
  assert.equal(REN_WARDROBE_REFERENCE.purpose, "paper_doll_guidance");
  assert.equal(REN_WARDROBE_REFERENCE.automaticGenerationInput, false);
  assert.equal(REN_WARDROBE_MANIFEST.faceAuthority, "none");
  assert.equal(REN_WARDROBE_MANIFEST.productionIntegration, "not_connected");
  assert.equal(REN_WARDROBE_MANIFEST.sourceOfTruth, "structured_manifest");
  assert.equal(REN_WARDROBE_MANIFEST.automaticGenerationInput, false);
  assert.deepEqual(REN_WARDROBE_MANIFEST.referenceHierarchy, {
    canonicalFace: REN_VISUAL_REFERENCE.assetPath,
    secondaryVisualStyle: REN_LOOKBOOK_REFERENCE.assetPath,
    wardrobeDocumentation: REN_WARDROBE_REFERENCE.assetPath,
  });
});

test("all four outfit groups contain complete, valid, reusable piece selections and every exclusion", () => {
  const manifest = REN_WARDROBE_MANIFEST;
  assert.deepEqual(Object.keys(manifest.outfits), ["at_home", "daytime_out", "casual_home", "kitchen_helping"]);
  for (const [key, piece] of Object.entries(manifest.pieces)) {
    assert.equal(piece.id, key);
    assert.ok(piece.label && piece.description && piece.notes.length);
  }
  const validateOption = (option: RenWardrobePieceOption) => {
    const id = typeof option === "string" ? option : option.pieceId;
    assert.ok(id in manifest.pieces, `Unknown piece ${id}`);
    if (typeof option !== "string") {
      const piece = manifest.pieces[id];
      const variants: readonly string[] = "variants" in piece ? piece.variants : [];
      assert.ok(variants.includes(option.variant), `Unknown variant ${option.variant} for ${id}`);
    }
  };
  for (const [key, entry] of Object.entries(manifest.outfits)) {
    const outfit: RenWardrobeOutfit = entry;
    assert.equal(outfit.id, key);
    assert.ok(outfit.label && outfit.contextTags.length && outfit.requiredPieces.length && outfit.notes.length);
    for (const selection of outfit.requiredPieces) {
      const alternatives = typeof selection !== "string" && "oneOf" in selection ? selection.oneOf : [selection];
      if (typeof selection !== "string" && "oneOf" in selection) {
        assert.equal(selection.choose, 1);
        assert.ok(selection.oneOf.length > 1);
      }
      for (const option of alternatives) validateOption(option);
    }
    for (const option of outfit.optionalPieces) validateOption(option);
    assert.deepEqual(outfit.exclusions, manifest.exclusions.map(({ id }) => id));
    assert.ok(outfit.requiredPieces.includes("black_feather_hair_adornments"));
  }
});

test("casual alternatives and kitchen layering do not default to combining tops or lingerie", () => {
  assert.deepEqual(REN_WARDROBE_OUTFITS.casual_home.requiredPieces[0], {
    choose: 1, oneOf: ["black_tube_top", { pieceId: "black_fitted_tee_tank", variant: "fitted_tee" }],
  });
  assert.ok(REN_WARDROBE_OUTFITS.kitchen_helping.requiredPieces.includes("practical_existing_outfit"));
  assert.ok(REN_WARDROBE_OUTFITS.kitchen_helping.requiredPieces.includes("black_gold_apron"));
  for (const id of ["casual_home", "kitchen_helping"] as const) {
    const outfit: RenWardrobeOutfit = REN_WARDROBE_OUTFITS[id];
    assert.ok(!outfit.requiredPieces.includes("black_base_layer"));
    assert.ok(!outfit.optionalPieces.includes("black_base_layer"));
    assert.ok(!outfit.optionalPieces.includes("celestial_robe"));
    assert.ok(outfit.exclusions.includes("no_casual_kitchen_lingerie"));
  }
});

test("wardrobe sheet bytes match the approved attachment and the face loader remains isolated", async () => {
  const root = new URL("../../../../", import.meta.url);
  const [stored, attached] = await Promise.all([
    readFile(new URL(REN_WARDROBE_REFERENCE.assetPath, root)),
    readFile(new URL("attached_assets/092E1985-D1A3-4A4A-801C-BF45D7621465_1791248623844.png", root)),
  ]);
  assert.deepEqual(stored, attached);
  assert.equal(createHash("sha256").update(stored).digest("hex"), "c7f4b302bfa99d51f4ae9bacaa3e95355ec73507d54c07cb35981e539675b493");
  const reads: string[] = [];
  await loadRenVisualReference(async (path) => {
    reads.push(path);
    return readFile(path);
  });
  assert.equal(reads.length, 1);
  assert.ok(reads[0].endsWith(REN_VISUAL_REFERENCE.assetPath));
  assert.ok(!reads[0].endsWith(REN_WARDROBE_REFERENCE.assetPath));
});
