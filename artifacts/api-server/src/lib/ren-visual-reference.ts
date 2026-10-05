import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REN_VISUAL_REFERENCE } from "../config/ren-visual-reference.js";
import { TestImageError } from "./test-image-generation.js";

function workspaceRoot(): string {
  // Works both from src/lib during tests and dist/index.mjs after bundling.
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new TestImageError(500, "Cannot locate the workspace containing Ren's approved canonical face reference. No image was generated.");
    }
    directory = parent;
  }
  return directory;
}

/** Read only; never resize, rewrite, cache a stale image, or fall back to text-only Ren. */
export async function loadRenVisualReference(
  readAsset: (path: string) => Promise<Buffer> = readFile,
): Promise<Buffer> {
  const assetPath = resolve(workspaceRoot(), REN_VISUAL_REFERENCE.assetPath);
  let bytes: Buffer;
  try {
    bytes = await readAsset(assetPath);
  } catch {
    throw new TestImageError(500,
      `Ren's approved canonical face reference (${REN_VISUAL_REFERENCE.identityReferenceVersion}) is missing or unreadable. No image was generated.`);
  }
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new TestImageError(500, "Ren's approved canonical face reference is not a valid PNG. No image was generated.");
  }
  return bytes;
}
