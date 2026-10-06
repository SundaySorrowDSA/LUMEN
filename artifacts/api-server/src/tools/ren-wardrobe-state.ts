import { desc, eq, sql } from "drizzle-orm";
import { assistantMemoryTable, db } from "@workspace/db";
import type { RenWardrobeState } from "./ren-image-prompt.js";
import { TestImageError } from "../lib/test-image-generation.js";
import {
  selectRenWardrobe, validateRenWardrobeState, wardrobePrompt, RenWardrobeSelectionError,
  type PersistedRenWardrobe, type WardrobeInput,
} from "./ren-wardrobe-selector.js";

export const REN_WARDROBE_MEMORY_LABEL = "Ren wardrobe";

type MemoryRecord = { id: number; content: string };
export type WardrobeTransaction = {
  read: () => Promise<MemoryRecord | undefined>;
  write: (state: PersistedRenWardrobe, existingId?: number) => Promise<void>;
};
export type WardrobeStore = {
  transaction: (run: (transaction: WardrobeTransaction) => Promise<RenWardrobeState>) => Promise<RenWardrobeState>;
};

function parseState(content: string): PersistedRenWardrobe | null {
  if (!content.trim().startsWith("{")) return null;
  let state: unknown;
  try { state = JSON.parse(content); } catch { throw new RenWardrobeSelectionError("Saved Ren wardrobe JSON is invalid."); }
  validateRenWardrobeState(state);
  return state;
}

export function createPostgresWardrobeStore(
  database: Pick<typeof db, "transaction"> = db,
  label = REN_WARDROBE_MEMORY_LABEL,
): WardrobeStore {
  return {
    transaction: (run) => database.transaction(async (tx) => {
      // Serialize the global current outfit across simultaneous requests and server instances.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1819631982)`);
      return run({
        read: async () => {
          const [entry] = await tx.select({ id: assistantMemoryTable.id, content: assistantMemoryTable.content })
            .from(assistantMemoryTable).where(eq(assistantMemoryTable.label, label))
            .orderBy(desc(assistantMemoryTable.createdAt), desc(assistantMemoryTable.id)).limit(1);
          return entry;
        },
        write: async (state, existingId) => {
          const content = JSON.stringify(state);
          if (existingId !== undefined) {
            await tx.update(assistantMemoryTable).set({ content }).where(eq(assistantMemoryTable.id, existingId));
          } else {
            // A legacy free-text row is preserved, not overwritten or deleted.
            await tx.insert(assistantMemoryTable).values({ label, category: "wardrobe", content });
          }
        },
      });
    }),
  };
}

const persistentStore = createPostgresWardrobeStore();

/** Lazy selection: invoked only for Ren images; never calls a model or image provider. */
export async function getOrSelectCurrentRenWardrobe(
  input: WardrobeInput,
  store: WardrobeStore = persistentStore,
): Promise<RenWardrobeState> {
  try {
    return await store.transaction(async (transaction) => {
      const entry = await transaction.read();
      let current = entry?.content.trim() ? parseState(entry.content) : null;
      const structured = current !== null;
      if (!current && entry?.content.trim()) {
        current = selectRenWardrobe({ ...input, prompt: entry.content, recentUserMessages: [], renChoice: undefined }, null);
        if (current.reason.trigger !== "user_request") {
          throw new RenWardrobeSelectionError("Existing Ren wardrobe memory does not match the approved manifest. Select an approved outfit or remove that memory before generating.");
        }
      }
      const next = selectRenWardrobe(input, current);
      validateRenWardrobeState(next);
      if (!structured || JSON.stringify(next) !== JSON.stringify(current)) {
        await transaction.write(next, structured ? entry!.id : undefined);
      }
      return wardrobePrompt(next);
    });
  } catch (error) {
    // Explicit failure before any paid image request; never silently discard corrupt state.
    if (error instanceof TestImageError) throw error;
    throw new TestImageError(
      error instanceof RenWardrobeSelectionError ? 400 : 503,
      error instanceof RenWardrobeSelectionError ? error.message : "Current Ren wardrobe could not be loaded or saved. No image was generated.",
    );
  }
}

/** Compatibility reader for existing callers; structured state is rendered into wardrobe text. */
export async function getCurrentRenWardrobe(): Promise<RenWardrobeState | null> {
  const [entry] = await db.select({ content: assistantMemoryTable.content })
    .from(assistantMemoryTable)
    .where(eq(assistantMemoryTable.label, REN_WARDROBE_MEMORY_LABEL))
    .orderBy(desc(assistantMemoryTable.createdAt), desc(assistantMemoryTable.id))
    .limit(1);
  if (!entry?.content.trim()) return null;
  const state = parseState(entry.content);
  return state ? wardrobePrompt(state) : { outfit: entry.content };
}
