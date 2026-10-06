import {
  REN_WARDROBE_MANIFEST as manifest,
  type RenWardrobePieceId,
  type RenWardrobePieceOption,
  type RenWardrobeSelection,
  type RenWardrobeOutfit,
} from "../config/ren-wardrobe.js";

export type RenOutfitId = keyof typeof manifest.outfits;
export type SelectedPiece = { pieceId: RenWardrobePieceId; variant?: string };
export class RenWardrobeSelectionError extends Error {}
type Context = { location: "home" | "out" | "unknown"; activity: "kitchen" | "relaxed" | "normal" | "unknown"; period: "daytime" | "evening" | "unknown" };
export type WardrobeMessage = { id: number; content: string; createdAt: string | Date };
export type WardrobeInput = {
  prompt: string;
  now?: Date;
  timeZone?: string;
  recentUserMessages?: WardrobeMessage[];
  renChoice?: WardrobeMessage;
};
export type PersistedRenWardrobe = {
  kind: "ren_wardrobe_state";
  schemaVersion: 1;
  manifestVersion: "v1";
  outfitId: RenOutfitId;
  selectedAt: string;
  selectedDate: string;
  timeZone: string;
  selectedRequiredPieces: SelectedPiece[];
  selectedOptionalPieces: SelectedPiece[];
  omittedPieces: RenWardrobePieceId[];
  basePieces: SelectedPiece[];
  context: Context;
  reason: { trigger: "initial" | "context_change" | "user_request" | "ren_choice" | "new_day"; explanation: string };
  lastRenChoiceMessageId: number | null;
};

const defaults: Partial<Record<RenWardrobePieceId, string>> = {
  black_fitted_tee_tank: "fitted_tee", black_hoodie_jacket: "hoodie",
  black_combat_platform_boots: "combat", black_base_layer: "base_layer",
  black_lounge_bottoms: "lounge_pants", gold_black_jewelry: "minimal",
};
const positiveText = (text: string) => text
  .replace(/\b(?:no|without|excluding|not)\s+[^.!?\n]+/gi, "")
  .toLowerCase();

function contextFrom(text: string): Partial<Context> {
  const value = positiveText(text);
  const context: Partial<Context> = {};
  if (/\b(?:finished cooking|done cooking|leaving the kitchen)\b/.test(value)) {
    context.activity = "normal";
  } else if (/\b(?:cooking|baking|kitchen|preparing (?:food|dinner|lunch|breakfast))\b/.test(value)) {
    context.activity = "kitchen"; context.location = "home";
  } else if (/\b(?:lounging|relaxing|relaxed|casual|sofa|couch|watching tv|reading|video call|bedtime)\b/.test(value)) {
    context.activity = "relaxed";
  }
  if (/\b(?:outside|outdoors|out of (?:the )?house|errands|shopping|daytime_out|going out|out and about)\b/.test(value)) {
    context.location = "out"; context.activity = "normal";
  } else if (/\b(?:at home|back home|indoors|indoor|inside|bedroom|living room|casual_home|at_home)\b/.test(value)) {
    context.location = "home";
  }
  if (/\b(?:daytime|morning|afternoon|daylight)\b/.test(value)) context.period = "daytime";
  else if (/\b(?:evening|night|bedtime)\b/.test(value)) context.period = "evening";
  return context;
}

function automaticOutfit(context: Context, text: string): RenOutfitId {
  if (context.activity === "kitchen") return "kitchen_helping";
  if (context.location === "out") return "daytime_out";
  if (/\bvideo calls?\b/i.test(text) || (context.location === "home" && context.period === "evening")) return "at_home";
  return "casual_home";
}

function explicitOutfit(text: string, context: Context): RenOutfitId | null {
  const value = positiveText(text);
  // Negated exclusions are stripped first; they must not become positive outfit requests.
  const clothing = /\b(?:wear(?:ing)?|dressed in|change(?:d|s)? into|changing into|put(?:ting)? on|outfit|in|with|hoodie|jacket|tank|t-shirt|tee|tube top|robe|apron|cargo pants|combat boots|platform boots|crossbody bag)\b/.test(value);
  if (clothing && /\b(?:(?:red|blue|white|pink|purple|green|yellow|silver)\s+(?:\w+\s+)?(?:shirt|t-shirt|tee|tank|hoodie|jacket|robe|apron|pants|top)|dress|gown|armor|corset|jeans|bikini|suit|skirt|sneakers|trainers|coat|sweater|blouse|uniform|tuxedo|feather crown|headdress)\b/.test(value)) {
    throw new RenWardrobeSelectionError("Requested clothing is outside Ren's approved wardrobe manifest. Choose an approved outfit or piece.");
  }
  for (const id of Object.keys(manifest.outfits) as RenOutfitId[]) {
    if (value.includes(id)) return id;
  }
  if (/\b(?:apron|kitchen helping outfit)\b/.test(value)) return "kitchen_helping";
  if (/\b(?:robe|lingerie|base layer|at.home outfit)\b/.test(value)) return "at_home";
  if (/\b(?:cargo pants|combat boots|platform boots|crossbody bag|daytime outfit)\b/.test(value)) return "daytime_out";
  if (/\b(?:tube top|t-shirt|fitted tee|lounge pants|shorts|casual outfit)\b/.test(value)) return "casual_home";
  if (/\bjacket\b/.test(value)) return "daytime_out";
  if (/\bhoodie\b/.test(value)) return context.location === "out" ? "daytime_out" : "casual_home";
  if (/\btank(?: top)?\b/.test(value)) return "daytime_out";
  if (/\b(?:wear(?:ing)?|dressed in|changing into|changed into)\b/.test(value) &&
      !/\b(?:current|same|usual|existing|comfortable|casual|practical|clothes|outfit)\b/.test(value)) {
    throw new RenWardrobeSelectionError("Could not match the requested clothing to Ren's approved wardrobe manifest.");
  }
  return null;
}

function resolvePiece(option: RenWardrobePieceOption, text = ""): SelectedPiece {
  const pieceId = typeof option === "string" ? option : option.pieceId;
  const piece = manifest.pieces[pieceId];
  let variant = typeof option === "string" ? defaults[pieceId] : option.variant;
  if ("variants" in piece) {
    const variants: readonly string[] = piece.variants;
    for (const candidate of variants) {
      if (typeof option === "string" && positiveText(text).includes(candidate.replaceAll("_", " "))) variant = candidate;
    }
    if (typeof option === "string" && pieceId === "black_fitted_tee_tank" && /\bt-shirt\b/i.test(text)) variant = "fitted_tee";
    if (pieceId === "black_lounge_bottoms" && /\bshorts\b/i.test(text)) variant = "shorts";
    if (!variant || !variants.includes(variant)) throw new RenWardrobeSelectionError(`Invalid approved variant for ${pieceId}.`);
  }
  return { pieceId, ...(variant ? { variant } : {}) };
}

function resolveSelection(selection: RenWardrobeSelection, text: string): SelectedPiece {
  if (typeof selection !== "string" && "oneOf" in selection) {
    const chosen = /\btube top\b/i.test(positiveText(text))
      ? selection.oneOf.find((option) => option === "black_tube_top")
      : selection.oneOf.find((option) => typeof option !== "string" && option.pieceId === "black_fitted_tee_tank");
    return resolvePiece(chosen ?? selection.oneOf[0], text);
  }
  return resolvePiece(selection, text);
}

export function isRenClothingChoice(text: string): boolean {
  return /\bI(?:'m| am|’m|'ve| have|’ve|'ll|’ll)?\s+(?:now\s+)?(?:changing into|changed into|change into|choose to wear|going to (?:wear|change into)|will change into|putting on)\b/i.test(text)
    && !/\b(?:maybe|might|could|tomorrow|later|if)\b/i.test(text);
}

function mentionsPiece(pieceId: RenWardrobePieceId, text: string): boolean {
  const patterns: Record<RenWardrobePieceId, RegExp> = {
    black_feather_hair_adornments: /\bfeathers?\b/i, gold_black_jewelry: /\bjewelry|earrings?|necklaces?|rings?\b/i,
    black_combat_platform_boots: /\bboots?\b/i, black_sun_crossbody_bag: /\b(?:crossbody|bag)\b/i,
    black_hoodie_jacket: /\b(?:hoodie|jacket)\b/i, black_cargo_pants: /\bcargo pants\b/i,
    black_fitted_tee_tank: /\b(?:t-shirt|tee|tank)\b/i, black_tube_top: /\btube top\b/i,
    celestial_robe: /\brobe\b/i, black_gold_apron: /\bapron\b/i,
    black_base_layer: /\b(?:lingerie|base layer)\b/i, black_lounge_bottoms: /\b(?:lounge pants|shorts)\b/i,
    practical_existing_outfit: /\bexisting outfit\b/i,
  };
  return patterns[pieceId].test(text);
}

export function selectRenWardrobe(input: WardrobeInput, current: PersistedRenWardrobe | null): PersistedRenWardrobe {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/New_York";
  const selectedDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const initial: Context = { location: "unknown", activity: "unknown", period: hour >= 6 && hour < 18 ? "daytime" : "evening" };
  let context: Context = { ...(current?.context ?? initial) };
  let contextEvidence = "";
  for (const message of input.recentUserMessages ?? []) {
    const date = new Date(message.createdAt).getTime();
    if (date > now.getTime() || now.getTime() - date > 86_400_000 || (current && date <= Date.parse(current.selectedAt))) continue;
    const detected = contextFrom(message.content);
    if (Object.keys(detected).length) {
      context = { ...context, ...detected }; contextEvidence = message.content;
    }
  }
  const detected = contextFrom(input.prompt);
  if (detected.location && detected.location !== context.location && !detected.activity) context.activity = "unknown";
  context = { ...context, ...detected };
  const explicit = explicitOutfit(input.prompt, context) ??
    (/\b(?:feathers?|jewelry)\b/i.test(input.prompt) ? current?.outfitId ?? automaticOutfit(context, input.prompt) : null);
  const renChoice = input.renChoice && input.renChoice.id > (current?.lastRenChoiceMessageId ?? 0)
    && (!current || new Date(input.renChoice.createdAt).getTime() > Date.parse(current.selectedAt))
    && new Date(input.renChoice.createdAt).getTime() <= now.getTime()
    && now.getTime() - new Date(input.renChoice.createdAt).getTime() < 86_400_000
    && isRenClothingChoice(input.renChoice.content) ? input.renChoice : undefined;
  const renOutfit = !explicit && renChoice ? explicitOutfit(renChoice.content, { ...context, ...contextFrom(renChoice.content) }) : null;
  if (renOutfit && renChoice) context = { ...context, ...contextFrom(renChoice.content) };
  const freshDay = current && current.selectedDate !== selectedDate && (hour >= 6 || Object.keys(detected).length > 0);
  if (freshDay && !detected.period) context.period = initial.period;
  const contextChanged = current && JSON.stringify(context) !== JSON.stringify(current.context);
  const outfitId = explicit ?? renOutfit ?? (contextChanged || freshDay || !current ? automaticOutfit(context, input.prompt + " " + contextEvidence) : current.outfitId);
  const trigger = explicit ? "user_request" : renOutfit ? "ren_choice" : !current ? "initial" : contextChanged ? "context_change" : freshDay ? "new_day" : null;
  if (!trigger && current) return current;
  if (current && !explicit && !renOutfit && outfitId === current.outfitId && !freshDay) {
    return { ...current, context };
  }
  const text = explicit ? input.prompt : renOutfit ? renChoice!.content : "";
  const sameFamily = current?.outfitId === outfitId;
  const omittedPieces: RenWardrobePieceId[] = sameFamily && !freshDay ? [...current.omittedPieces] : [];
  for (const [id, pattern] of [
    ["black_feather_hair_adornments", /\b(?:no|without)\s+(?:black\s+)?feathers?\b/i],
    ["gold_black_jewelry", /\b(?:no|without)\s+jewelry\b/i],
  ] as const) {
    if (pattern.test(text) && !omittedPieces.includes(id)) omittedPieces.push(id);
    else if (mentionsPiece(id, positiveText(text))) {
      const index = omittedPieces.indexOf(id);
      if (index >= 0) omittedPieces.splice(index, 1);
    }
  }
  const outfit: RenWardrobeOutfit = manifest.outfits[outfitId];
  const selectedRequiredPieces = outfit.requiredPieces.map((selection) => {
    const options = typeof selection !== "string" && "oneOf" in selection ? selection.oneOf : [selection];
    const ids = options.map((option) => typeof option === "string" ? option : option.pieceId);
    const previous = sameFamily && !freshDay ? current.selectedRequiredPieces.find(({ pieceId }) => ids.includes(pieceId)) : undefined;
    return previous && !ids.some((id) => mentionsPiece(id, text)) ? previous : resolveSelection(selection, text);
  })
    .filter(({ pieceId }) => !omittedPieces.includes(pieceId));
  const selectedOptionalPieces = outfit.optionalPieces.filter((option) => {
    const id = typeof option === "string" ? option : option.pieceId;
    const denied = /\b(?:no|without)\s+(hoodie|jacket|jewelry)\b/i.exec(text);
    if (denied && mentionsPiece(id, denied[1])) return false;
    return mentionsPiece(id, positiveText(text)) ||
      Boolean(sameFamily && !freshDay && current.selectedOptionalPieces.some(({ pieceId }) => pieceId === id));
  }).map((option) => {
    const id = typeof option === "string" ? option : option.pieceId;
    return sameFamily && !freshDay && !mentionsPiece(id, text)
      ? current.selectedOptionalPieces.find(({ pieceId }) => pieceId === id) ?? resolvePiece(option, text)
      : resolvePiece(option, text);
  }).filter(({ pieceId }) => !omittedPieces.includes(pieceId));
  const basePieces = outfitId === "kitchen_helping"
    ? (current?.outfitId === "kitchen_helping" ? current.basePieces
      : current && current.outfitId !== "at_home"
        ? [...current.selectedRequiredPieces, ...current.selectedOptionalPieces].filter(({ pieceId }) =>
          ["top", "bottoms", "outerwear"].includes(manifest.pieces[pieceId].category))
        : manifest.outfits.casual_home.requiredPieces.map((selection) => resolveSelection(selection, ""))
          .filter(({ pieceId }) => ["top", "bottoms"].includes(manifest.pieces[pieceId].category)))
    : [];
  const lastRenChoiceMessageId = renChoice?.id ?? current?.lastRenChoiceMessageId ?? null;
  // Reaffirming identical clothing does not reset its timestamp or discard its continuity.
  const sameClothes = current && current.outfitId === outfitId &&
    JSON.stringify([current.selectedRequiredPieces, current.selectedOptionalPieces, current.omittedPieces]) ===
    JSON.stringify([selectedRequiredPieces, selectedOptionalPieces, omittedPieces]);
  if (current && sameClothes && !freshDay) return { ...current, context, lastRenChoiceMessageId };
  return {
    kind: "ren_wardrobe_state", schemaVersion: 1, manifestVersion: "v1",
    outfitId, selectedAt: now.toISOString(), selectedDate, timeZone,
    selectedRequiredPieces, selectedOptionalPieces, omittedPieces, basePieces, context,
    reason: { trigger: trigger!, explanation: explicit ? "Explicit approved user outfit request." : renOutfit ? "Ren explicitly chose to change clothing." : freshDay ? "Fresh outfit selection on a new local day." : `Context selection: ${context.location}, ${context.activity}, ${context.period}.` },
    lastRenChoiceMessageId,
  };
}

export function validateRenWardrobeState(value: unknown): asserts value is PersistedRenWardrobe {
  const state = value as PersistedRenWardrobe;
  if (!state || state.kind !== "ren_wardrobe_state" || state.schemaVersion !== 1 || state.manifestVersion !== "v1" ||
      !Object.hasOwn(manifest.outfits, state.outfitId) || !Number.isFinite(Date.parse(state.selectedAt)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.selectedDate) || typeof state.timeZone !== "string" ||
      !state.context || !["home", "out", "unknown"].includes(state.context.location) ||
      !["kitchen", "relaxed", "normal", "unknown"].includes(state.context.activity) ||
      !["daytime", "evening", "unknown"].includes(state.context.period) ||
      !state.reason || !["initial", "context_change", "user_request", "ren_choice", "new_day"].includes(state.reason.trigger) ||
      typeof state.reason.explanation !== "string" ||
      !(state.lastRenChoiceMessageId === null || Number.isInteger(state.lastRenChoiceMessageId))) {
    throw new RenWardrobeSelectionError("Saved Ren wardrobe state is invalid; correct or remove the Ren wardrobe memory before generating.");
  }
  for (const list of [state.selectedRequiredPieces, state.selectedOptionalPieces, state.basePieces]) {
    if (!Array.isArray(list) || new Set(list.map((piece) => piece?.pieceId)).size !== list.length) throw new RenWardrobeSelectionError("Saved Ren wardrobe pieces are invalid.");
    for (const selected of list) {
      if (!selected || !Object.hasOwn(manifest.pieces, selected.pieceId)) throw new RenWardrobeSelectionError("Saved wardrobe contains an unapproved piece.");
      const piece = manifest.pieces[selected.pieceId];
      const variants: readonly string[] = "variants" in piece ? piece.variants : [];
      if (variants.length ? !selected.variant || !variants.includes(selected.variant) : selected.variant !== undefined) throw new RenWardrobeSelectionError("Saved wardrobe contains an invalid variant.");
    }
  }
  if (!Array.isArray(state.omittedPieces) || state.omittedPieces.some((id) => !["black_feather_hair_adornments", "gold_black_jewelry"].includes(id))) throw new RenWardrobeSelectionError("Invalid wardrobe omissions.");
  const outfit: RenWardrobeOutfit = manifest.outfits[state.outfitId];
  const permitted = (option: RenWardrobePieceOption) => typeof option === "string" ? option : option.pieceId;
  const required = outfit.requiredPieces.map((selection) => typeof selection !== "string" && "oneOf" in selection ? selection.oneOf.map(permitted) : [permitted(selection)]);
  const matches = (piece: SelectedPiece, option: RenWardrobePieceOption) =>
    piece.pieceId === permitted(option) && (typeof option === "string" || piece.variant === option.variant);
  const requiredOptions = outfit.requiredPieces.flatMap((selection) =>
    typeof selection !== "string" && "oneOf" in selection ? selection.oneOf : [selection]);
  if (state.selectedRequiredPieces.length !== required.filter((ids) => !ids.some((id) => state.omittedPieces.includes(id))).length ||
      required.some((ids) => !ids.some((id) => state.omittedPieces.includes(id) || state.selectedRequiredPieces.some((piece) => piece.pieceId === id))) ||
      state.selectedRequiredPieces.some((piece) => !requiredOptions.some((option) => matches(piece, option))) ||
      state.selectedOptionalPieces.some((piece) => !outfit.optionalPieces.some((option) => matches(piece, option))) ||
      state.basePieces.some(({ pieceId }) => !["top", "bottoms", "outerwear"].includes(manifest.pieces[pieceId].category)) ||
      (state.outfitId !== "kitchen_helping" && state.basePieces.length > 0) ||
      (state.outfitId === "kitchen_helping" && !state.basePieces.length)) {
    throw new RenWardrobeSelectionError("Saved wardrobe combines invalid pieces or outfit families.");
  }
  if (state.outfitId === "kitchen_helping" &&
      (state.basePieces.filter(({ pieceId }) => manifest.pieces[pieceId].category === "top").length !== 1 ||
       state.basePieces.filter(({ pieceId }) => manifest.pieces[pieceId].category === "bottoms").length !== 1 ||
       state.basePieces.filter(({ pieceId }) => manifest.pieces[pieceId].category === "outerwear").length > 1)) {
    throw new RenWardrobeSelectionError("Kitchen clothing must retain one practical top/bottom combination.");
  }
}

export function wardrobePrompt(state: PersistedRenWardrobe): { outfit: string } {
  validateRenWardrobeState(state);
  const describe = (piece: SelectedPiece) => {
    const definition = manifest.pieces[piece.pieceId];
    // Resolve the manifest's "or" wording; never ask the provider to choose variants again.
    const description = definition.description
      .replace("T-shirt or tank top", piece.variant === "fitted_tank" ? "tank top" : "T-shirt")
      .replace("hoodie or jacket", piece.variant === "jacket" ? "jacket" : "hoodie")
      .replace("combat or platform boots", piece.variant === "platform" ? "platform boots" : "combat boots")
      .replace("lounge pants or shorts", piece.variant === "shorts" ? "shorts" : "lounge pants")
      .replace("lingerie or a black base layer", piece.variant === "lingerie" ? "lingerie" : "base layer");
    return `${description}${piece.variant ? ` Selected variant: ${piece.variant.replaceAll("_", " ")}.` : ""}`;
  };
  const pieces = [...state.selectedRequiredPieces, ...state.selectedOptionalPieces];
  return { outfit: [
    `Selected approved outfit: ${manifest.outfits[state.outfitId].label}.`,
    ...pieces.map(describe),
    ...(state.basePieces.length ? ["Practical existing clothing under the apron:", ...state.basePieces.map(describe)] : []),
    ...state.omittedPieces.map((id) => `Do not include ${manifest.pieces[id].label.toLowerCase()} in this outfit.`),
    ...manifest.exclusions.map(({ rule }) => rule),
    "Only the selected pieces above are worn; optional pieces not selected are not added.",
  ].join(" ") };
}
