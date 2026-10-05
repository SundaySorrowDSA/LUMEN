import assert from "node:assert/strict";
import test from "node:test";
import { planConsolidation, type MigrationMessage } from "./ren-thread-consolidation.js";

const fixture = (id: number, overrides: Partial<MigrationMessage> = {}): MigrationMessage => ({
  id, conversation_id: 2, role: "assistant", content: "Fixture only",
  model: "fixture", metadata: null, created_at: "2026-10-01T12:00:00.123456+00:00", ...overrides,
});

test("consolidation uses non-persistent fixtures and preserves timestamp order without mutating originals", () => {
  const sources = [fixture(3, { created_at: "2026-10-02T12:00:00+00:00" }), fixture(2)];
  const before = structuredClone(sources);
  const plan = planConsolidation([], sources);
  assert.deepEqual(plan.imports.map((item) => item.id), [2, 3]);
  assert.deepEqual(sources, before);
});

test("exact duplicates are skipped but repeated text with different timestamps is retained", () => {
  const plan = planConsolidation([fixture(1)], [fixture(2), fixture(3, { created_at: "2026-10-02T12:00:00+00:00" })]);
  assert.deepEqual(plan.duplicates.map((item) => item.id), [2]);
  assert.deepEqual(plan.imports.map((item) => item.id), [3]);
});

test("image and tool metadata remain significant; metadata key ordering is irrelevant", () => {
  const metadata = { generatedImage: { objectPath: "/objects/fixture.png" }, toolResults: [{ text: "saved result" }] };
  const canonical = fixture(1, { metadata: JSON.stringify(metadata) });
  const identical = fixture(2, { metadata: JSON.stringify({ toolResults: metadata.toolResults, generatedImage: metadata.generatedImage }) });
  const different = fixture(3, { metadata: JSON.stringify({ ...metadata, toolResults: [{ text: "other result" }] }) });
  const plan = planConsolidation([canonical], [identical, different]);
  assert.deepEqual(plan.imports.map((item) => item.id), [3]);
  assert.equal(plan.imports[0].metadata, different.metadata);
});

test("source provenance makes rerunning a consolidation idempotent", () => {
  const source = fixture(2);
  const imported = fixture(10, { conversation_id: 1, metadata: JSON.stringify({
    threadConsolidation: { sourceConversationId: 2, sourceMessageId: 2 },
  }) });
  assert.equal(planConsolidation([imported], [source]).imports.length, 0);
});

test("malformed metadata stops the migration rather than dropping stored data", () => {
  assert.throws(() => planConsolidation([], [fixture(1, { metadata: "invalid" })]));
});
