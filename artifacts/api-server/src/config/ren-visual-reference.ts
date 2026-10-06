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

/**
 * Approved style metadata for future wardrobe/reference logic only.
 * Never a face authority or an automatic production image input.
 */
export const REN_LOOKBOOK_REFERENCE = {
  character: "Ren",
  referenceVersion: "v1",
  lookbookAsset: "ren-lookbook-v1.png",
  assetPath: "artifacts/api-server/assets/characters/ren/ren-lookbook-v1.png",
  role: "visual_style_reference",
  status: "approved",
  identityPriority: "secondary",
  wardrobePriority: "high",
  accessoryPriority: "high",
  faceAuthority: "none",
  automaticGenerationInput: false,
  note: "Defines how Ren generally dresses and presents herself, not who she is. ren-face-v1.png remains the single authoritative canonical face reference with highest priority.",
  interpretationRules: [
    "Use for wardrobe families, black-and-gold styling, subtle feather placement, simple jewelry, boots, bag, casual clothing, and overall presentation.",
    "Treat each depicted outfit as a separate possible wardrobe direction; do not combine every outfit into one generation.",
    "Do not copy text, labels, collage layout, borders, or typography into generated images.",
    "Do not increase fantasy ornamentation because several examples appear on one sheet.",
    "Preserve normal, wearable clothing and restrained accessories; subtle black feathers remain a recurring Ren signature.",
    "Clothing remains independently selectable by the wardrobe system.",
    "Never use this lookbook to redefine or override Ren's canonical facial identity.",
  ],
} as const;
