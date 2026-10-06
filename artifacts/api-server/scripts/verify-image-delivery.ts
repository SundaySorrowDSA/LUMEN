/**
 * Opt-in, single live image verification. No Kindroid chat mutation, committed
 * test threads, wardrobe edits, or retained test storage objects.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import pino from "pino";
import { db, pool, assistantConversationsTable, assistantMessagesTable } from "@workspace/db";
import { resolveConversationImageRequest } from "../src/tools/conversation-image-request.js";
import { generateConversationImage } from "../src/tools/ren-image-prompt.js";
import { getCurrentRenWardrobe } from "../src/tools/ren-wardrobe-state.js";
import { readGeneratedImage, deleteGeneratedImage } from "../src/lib/generated-image-storage.js";
import { generatedImageFromMetadata } from "../src/tools/image-generation.js";
import { enforceImageDeliveryStatus } from "../src/tools/image-delivery-status.js";

assert.equal(process.env.VERIFY_LIVE_IMAGE_DELIVERY, "1", "Explicit opt-in required: this makes one paid image request.");
const request = "Can you Send me a picture?";
const resolved = resolveConversationImageRequest(request, { assistantCharacter: "Ren" });
assert.ok(resolved);
assert.ok(process.env.OPENAI_API_KEY, "Image provider must be configured.");
let objectPath: string | undefined;
const rollback = new Error("Intentional fixture rollback");
try {
  const image = await generateConversationImage(resolved.prompt, {
    apiKey: process.env.OPENAI_API_KEY,
    logger: pino(),
    readWardrobe: getCurrentRenWardrobe,
  });
  objectPath = image.objectPath;
  const bytes = await readGeneratedImage(image.objectPath);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await writeFile("/tmp/lumen-delivery-live.png", bytes);
  await db.transaction(async tx => {
    const [conversation] = await tx.insert(assistantConversationsTable)
      .values({ title: "Isolated image delivery fixture" }).returning();
    const [userMessage] = await tx.insert(assistantMessagesTable).values({
      conversationId: conversation.id, role: "user", content: request,
    }).returning();
    const [assistantMessage] = await tx.insert(assistantMessagesTable).values({
      conversationId: conversation.id, role: "assistant",
      content: enforceImageDeliveryStatus("The servers are rendering my beauty.", true),
      model: "kindroid", metadata: JSON.stringify({ generatedImage: image }),
    }).returning();
    const [saved] = await tx.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, assistantMessage.id));
    assert.equal(generatedImageFromMetadata(saved.metadata)?.objectPath, image.objectPath);
    await writeFile("/tmp/lumen-delivery-fixture.json", JSON.stringify({
      conversation: { ...conversation, messages: [userMessage, assistantMessage] },
      pair: { userMessage, assistantMessage },
    }));
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
  console.log("PASS live provider PNG, App Storage readback, transactional metadata readback; fixture rolled back.");
} finally {
  if (objectPath) await deleteGeneratedImage(objectPath);
  await pool.end();
}
