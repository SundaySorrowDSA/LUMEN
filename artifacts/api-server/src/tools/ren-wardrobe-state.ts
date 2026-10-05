import { desc, eq } from "drizzle-orm";
import { assistantMemoryTable, db } from "@workspace/db";
import type { RenWardrobeState } from "./ren-image-prompt.js";

export const REN_WARDROBE_MEMORY_LABEL = "Ren wardrobe";

/** Existing Memory UI/API can supply current wardrobe without a new state system. */
export async function getCurrentRenWardrobe(): Promise<RenWardrobeState | null> {
  const [entry] = await db.select({ content: assistantMemoryTable.content })
    .from(assistantMemoryTable)
    .where(eq(assistantMemoryTable.label, REN_WARDROBE_MEMORY_LABEL))
    .orderBy(desc(assistantMemoryTable.createdAt), desc(assistantMemoryTable.id))
    .limit(1);
  return entry?.content.trim() ? { outfit: entry.content } : null;
}
