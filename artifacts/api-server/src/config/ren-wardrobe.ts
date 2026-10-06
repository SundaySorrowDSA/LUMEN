import { REN_LOOKBOOK_REFERENCE, REN_VISUAL_REFERENCE, REN_WARDROBE_REFERENCE } from "./ren-visual-reference.js";

type WardrobePiece = {
  id: string;
  label: string;
  category: "hair_adornment" | "jewelry" | "footwear" | "bag" | "outerwear" | "bottoms" | "top" | "robe" | "apron" | "base_layer" | "existing_outfit";
  description: string;
  variants?: readonly string[];
  notes: readonly string[];
};

export const REN_WARDROBE_PIECES = {
  black_feather_hair_adornments: {
    id: "black_feather_hair_adornments", label: "Subtle black feather hair adornments", category: "hair_adornment",
    description: "Small, tasteful, natural black feather accents in her hair.",
    notes: ["Secondary Ren marker, not facial identity.", "May adapt to hair tied or partially up; never a crown or headdress.", "Scene or explicit wardrobe instructions can override this default."],
  },
  gold_black_jewelry: {
    id: "gold_black_jewelry", label: "Restrained gold-and-black jewelry", category: "jewelry",
    description: "Restrained gold accents and black details in simple earrings, necklaces, or rings.",
    variants: ["minimal", "restrained_layered"],
    notes: ["Keep accessories restrained; do not wear every jewelry example together.", "Use minimal styling for casual and kitchen contexts."],
  },
  black_combat_platform_boots: {
    id: "black_combat_platform_boots", label: "Black combat/platform boots", category: "footwear",
    description: "Practical black lace-up combat or platform boots.",
    variants: ["combat", "platform"],
    notes: ["Signature daytime footwear, not armor."],
  },
  black_sun_crossbody_bag: {
    id: "black_sun_crossbody_bag", label: "Black crossbody bag with gold sun emblem", category: "bag",
    description: "Practical black crossbody bag featuring a gold sun emblem.",
    notes: ["Signature daytime accessory.", "A small feather charm is optional, not a reason to add excessive ornamentation."],
  },
  black_hoodie_jacket: {
    id: "black_hoodie_jacket", label: "Black hoodie or jacket", category: "outerwear",
    description: "Normal wearable black hoodie or jacket with optional subtle gold accents.",
    variants: ["hoodie", "jacket"],
    notes: ["Choose one outerwear variant.", "Optional in casual home scenes; not a fantasy cloak."],
  },
  black_cargo_pants: {
    id: "black_cargo_pants", label: "Black cargo pants", category: "bottoms",
    description: "Practical black cargo pants with restrained straps or rings.",
    notes: ["Keep straps and rings functional-looking, not armor or excessive harness ornamentation."],
  },
  black_fitted_tee_tank: {
    id: "black_fitted_tee_tank", label: "Black fitted tee or tank", category: "top",
    description: "Plain, fitted black T-shirt or tank top.",
    variants: ["fitted_tee", "fitted_tank"],
    notes: ["Choose one top variant.", "Keep clothing ordinary and wearable."],
  },
  black_tube_top: {
    id: "black_tube_top", label: "Black tube top", category: "top",
    description: "Simple black tube top for comfortable casual wear.",
    notes: ["An alternative to a fitted tee, not an additional layered top by default.", "Do not turn casual wear into lingerie styling."],
  },
  celestial_robe: {
    id: "celestial_robe", label: "Sheer black celestial robe", category: "robe",
    description: "Sheer black at-home robe with restrained celestial detailing.",
    notes: ["Specific to the at-home wardrobe family.", "Not celestial regalia, a fantasy gown, or a default for casual/kitchen scenes."],
  },
  black_gold_apron: {
    id: "black_gold_apron", label: "Small black-and-gold apron", category: "apron",
    description: "Small practical black apron with restrained gold accents.",
    notes: ["Layer over an otherwise practical existing outfit.", "Domestic cooking/helping accessory, not a burlesque costume."],
  },
  black_base_layer: {
    id: "black_base_layer", label: "Black lingerie/base layer", category: "base_layer",
    description: "Black lingerie or a black base layer beneath the at-home robe.",
    variants: ["lingerie", "base_layer"],
    notes: ["Belongs to the at_home family; never automatically transfer to casual or kitchen outfits."],
  },
  black_lounge_bottoms: {
    id: "black_lounge_bottoms", label: "Black lounge pants or shorts", category: "bottoms",
    description: "Comfortable ordinary black lounge pants or shorts.",
    variants: ["lounge_pants", "shorts"],
    notes: ["Choose one bottom variant.", "Comfortable casual clothing, not lingerie."],
  },
  practical_existing_outfit: {
    id: "practical_existing_outfit", label: "Practical existing outfit", category: "existing_outfit",
    description: "The independently selected practical outfit already being worn beneath an apron.",
    notes: ["Preserve the existing clothing selection instead of choosing or combining another wardrobe family.", "An apron does not require a new revealing base outfit."],
  },
} as const satisfies Record<string, WardrobePiece>;

export type RenWardrobePieceId = keyof typeof REN_WARDROBE_PIECES;
export type RenWardrobePieceOption = RenWardrobePieceId | {
  pieceId: RenWardrobePieceId;
  variant: string;
};
export type RenWardrobeSelection = RenWardrobePieceOption | {
  choose: 1;
  oneOf: readonly RenWardrobePieceOption[];
};

export const REN_WARDROBE_EXCLUSIONS = [
  { id: "no_family_combination", rule: "Do not combine all wardrobe families at once; select one context-appropriate family." },
  { id: "no_excessive_fantasy", rule: "Do not add excessive fantasy ornamentation or increase outfit/jewelry complexity because several examples appear on the sheet." },
  { id: "no_feather_crowns", rule: "Do not add oversized feather crowns or elaborate headdresses; feathers remain small and tasteful." },
  { id: "no_casual_kitchen_lingerie", rule: "Do not turn casual or kitchen scenes into lingerie/burlesque styling unless explicitly requested." },
  { id: "no_face_override", rule: "Do not let this wardrobe manifest override Ren's sole authoritative canonical face reference." },
] as const;

type ExclusionId = typeof REN_WARDROBE_EXCLUSIONS[number]["id"];
export type RenWardrobeOutfit = {
  id: string;
  label: string;
  contextTags: readonly string[];
  requiredPieces: readonly RenWardrobeSelection[];
  optionalPieces: readonly RenWardrobePieceOption[];
  exclusions: readonly ExclusionId[];
  notes: readonly string[];
};

const allExclusions = REN_WARDROBE_EXCLUSIONS.map(({ id }) => id);

export const REN_WARDROBE_OUTFITS = {
  at_home: {
    id: "at_home", label: "At home — celestial robe",
    contextTags: ["home", "relaxing", "video_calls"],
    requiredPieces: ["celestial_robe", "black_base_layer", "black_feather_hair_adornments", { pieceId: "gold_black_jewelry", variant: "restrained_layered" }],
    optionalPieces: [],
    exclusions: allExclusions,
    notes: ["Sheer black robe over a black lingerie/base layer; restrained layered gold jewelry.", "Comfortable at-home direction, not the automatic outfit for all indoor scenes.", "Do not transfer this family's robe/base layer into casual or kitchen outfits by default."],
  },
  daytime_out: {
    id: "daytime_out", label: "Daytime / out and about — practical signature",
    contextTags: ["errands", "daytime", "out_of_house"],
    requiredPieces: [{ pieceId: "black_fitted_tee_tank", variant: "fitted_tank" }, "black_hoodie_jacket", "black_cargo_pants", "black_combat_platform_boots", "black_sun_crossbody_bag", "black_feather_hair_adornments"],
    optionalPieces: ["gold_black_jewelry"],
    exclusions: allExclusions,
    notes: ["Prefer the fitted tank/top variant for this daytime direction.", "Use subtle gold accents, restrained straps/rings, practical boots, and the sun-emblem bag.", "Choose one hoodie/jacket variant and one combat/platform boot variant."],
  },
  casual_home: {
    id: "casual_home", label: "Casual home — comfortable",
    contextTags: ["casual_home", "lounging"],
    requiredPieces: [
      { choose: 1, oneOf: ["black_tube_top", { pieceId: "black_fitted_tee_tank", variant: "fitted_tee" }] },
      "black_lounge_bottoms", "black_feather_hair_adornments",
    ],
    optionalPieces: [{ pieceId: "black_hoodie_jacket", variant: "hoodie" }, { pieceId: "gold_black_jewelry", variant: "minimal" }],
    exclusions: allExclusions,
    notes: ["Choose a tube top OR fitted tee, not both; use the fitted_tee variant when selecting black_fitted_tee_tank.", "Choose lounge pants OR shorts.", "Optional outerwear uses the hoodie variant; jewelry, if worn, stays minimal.", "Normal comfortable casual clothing, not lingerie/burlesque styling."],
  },
  kitchen_helping: {
    id: "kitchen_helping", label: "Kitchen / helping — practical apron",
    contextTags: ["cooking", "helping_in_kitchen"],
    requiredPieces: ["practical_existing_outfit", "black_gold_apron", "black_feather_hair_adornments"],
    optionalPieces: [{ pieceId: "gold_black_jewelry", variant: "minimal" }],
    exclusions: allExclusions,
    notes: ["Small black-and-gold apron over practical existing clothing, not a replacement outfit.", "Hair may be tied or partially up while retaining subtle feather detail.", "Jewelry, if worn, stays minimal.", "Keep this domestic and practical; do not automatically borrow the at-home lingerie/base layer."],
  },
} as const satisfies Record<string, RenWardrobeOutfit>;

/**
 * Machine-readable wardrobe source of truth; not connected to production generation.
 * The image sheet is reference documentation, not an image the provider must receive.
 */
export const REN_WARDROBE_MANIFEST = {
  character: "Ren",
  version: "v1",
  purpose: "paper_doll_guidance",
  status: "approved",
  faceAuthority: "none",
  automaticGenerationInput: false,
  productionIntegration: "not_connected",
  sourceOfTruth: "structured_manifest",
  referenceHierarchy: {
    canonicalFace: REN_VISUAL_REFERENCE.assetPath,
    secondaryVisualStyle: REN_LOOKBOOK_REFERENCE.assetPath,
    wardrobeDocumentation: REN_WARDROBE_REFERENCE.assetPath,
  },
  selectionRules: [
    "Select one wardrobe family based on independently chosen context; do not combine every family.",
    "Choose exactly one option from each required oneOf selection, and one variant for pieces that offer alternatives.",
    "Optional pieces are not automatically included; keep jewelry and accessories restrained.",
    "Honor explicit clothing choices and scene constraints; small hair feathers are an overridable default.",
    "Casual/kitchen lingerie or burlesque styling requires an explicit request; never infer it from the reference sheet.",
    "Never copy sheet text, labels, typography, borders, or collage layout.",
    "Facial identity and eye appearance are controlled by the canonical face reference, never by wardrobe documentation.",
  ],
  pieces: REN_WARDROBE_PIECES,
  outfits: REN_WARDROBE_OUTFITS,
  exclusions: REN_WARDROBE_EXCLUSIONS,
} as const;
