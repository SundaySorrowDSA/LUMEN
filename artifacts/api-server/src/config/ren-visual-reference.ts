/**
 * Single source of truth for Ren's approved primary identity reference.
 */
export const REN_VISUAL_REFERENCE = {
  character: "Ren",
  identityReferenceVersion: "v1",
  primaryFaceAsset: "ren-face-v1.png",
  assetPath: "artifacts/api-server/assets/characters/ren/ren-face-v1.png",
  role: "identity_primary",
  status: "approved",
  identityPriority: "high",
  outfitPriority: "low",
  note: "This image defines Ren's canonical face. Clothing in this image is NOT a required canonical outfit.",
} as const;
