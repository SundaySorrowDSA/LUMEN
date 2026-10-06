import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { REN_LOOKBOOK_REFERENCE, REN_VISUAL_REFERENCE } from "./ren-visual-reference.js";
import { loadRenVisualReference } from "../lib/ren-visual-reference.js";

test("approved lookbook metadata has style priorities but no face authority or automatic generation input", () => {
  assert.equal(REN_LOOKBOOK_REFERENCE.character, "Ren");
  assert.equal(REN_LOOKBOOK_REFERENCE.referenceVersion, "v1");
  assert.equal(REN_LOOKBOOK_REFERENCE.role, "visual_style_reference");
  assert.equal(REN_LOOKBOOK_REFERENCE.status, "approved");
  assert.equal(REN_LOOKBOOK_REFERENCE.identityPriority, "secondary");
  assert.equal(REN_LOOKBOOK_REFERENCE.wardrobePriority, "high");
  assert.equal(REN_LOOKBOOK_REFERENCE.accessoryPriority, "high");
  assert.equal(REN_LOOKBOOK_REFERENCE.faceAuthority, "none");
  assert.equal(REN_LOOKBOOK_REFERENCE.automaticGenerationInput, false);
  assert.equal(REN_VISUAL_REFERENCE.role, "identity_primary");
  assert.equal(REN_VISUAL_REFERENCE.primaryFaceAsset, "ren-face-v1.png");
  assert.notEqual(REN_LOOKBOOK_REFERENCE.assetPath, REN_VISUAL_REFERENCE.assetPath);
  assert.match(REN_LOOKBOOK_REFERENCE.interpretationRules.join("\n"), /separate possible wardrobe direction/);
  assert.match(REN_LOOKBOOK_REFERENCE.interpretationRules.join("\n"), /text, labels, collage layout, borders, or typography/);
  assert.match(REN_LOOKBOOK_REFERENCE.interpretationRules.join("\n"), /independently selectable/);
});

test("primary reference loader still reads only the canonical face, never the approved lookbook", async () => {
  const canonical = await loadRenVisualReference();
  const reads: string[] = [];
  const loaded = await loadRenVisualReference(async (path) => {
    reads.push(path);
    return readFile(path);
  });
  assert.equal(reads.length, 1);
  assert.ok(reads[0].endsWith(REN_VISUAL_REFERENCE.assetPath));
  assert.ok(!reads[0].endsWith(REN_LOOKBOOK_REFERENCE.assetPath));
  assert.deepEqual(loaded, canonical);
});

test("stored lookbook is byte-for-byte identical to the approved attachment", async () => {
  const root = new URL("../../../../", import.meta.url);
  const [stored, attached] = await Promise.all([
    readFile(fileURLToPath(new URL(REN_LOOKBOOK_REFERENCE.assetPath, root))),
    readFile(fileURLToPath(new URL("attached_assets/057CB9E9-08C2-49AA-A5F5-866DE62D39CB_1791246922184.png", root))),
  ]);
  assert.deepEqual(stored, attached);
});
