/**
 * Local, compositional intent analysis: speech act + visual object + depicted
 * subject. Vocabulary and grammatical roles are shared across phrasings; the
 * labeled examples live only in tests. No provider/classification call is made.
 */
export type SemanticImageIntent = {
  target: "assistant" | "previous_image" | "other" | "none";
  kind: "outfit" | "appearance";
  framing: "image" | "selfie" | "portrait";
  repeat: boolean;
  differentAngle: boolean;
  closeUp: boolean;
  blocked: boolean;
  clause: string;
};

const PHOTO = new Set(["image", "picture", "pic", "photo", "photograph", "selfie", "portrait", "illustration", "snapshot", "headshot", "closeup"]);
const CAPTURE = new Set(["take", "snap", "shoot", "capture", "generate", "create", "make", "draw"]);
const RECEIVE = new Set(["send", "share", "give", "get", "have", "receive", "grab"]);
const VIEW = new Set(["show", "see", "look", "reveal"]);
const ACTION = new Set([...CAPTURE, ...RECEIVE, ...VIEW]);
const EXPLAIN = new Set(["explain", "teach", "help", "learn", "understand", "know", "tell", "talk", "discuss", "remember", "recall", "instructions", "instruction", "tutorial", "tips", "advice"]);
const TEXT_ARTIFACT = new Set(["code", "report", "plan", "schedule", "explanation", "instructions", "tutorial"]);
const INSPECT = new Set(["inspect", "analyze", "analyse", "describe", "review", "identify", "recognize", "recognise", "assess"]);
const POLITE = new Set(["hey", "hi", "hello", "ren", "lumen", "please", "baby", "babe", "darling", "sweetheart", "love", "dear", "ok", "okay", "yes", "sure"]);
const MODAL = new Set(["can", "could", "would", "will", "may"]);
const OUTFIT = new Set(["outfit", "clothes", "clothing", "attire", "ensemble", "wardrobe"]);
const SELF_BODY = new Set(["face", "appearance", "eyes", "smile"]);
const LEMMAS: Record<string, string> = {
  photos: "photo", pictures: "picture", pics: "pic", images: "image", selfies: "selfie",
  photographs: "photograph", portraits: "portrait", snapshots: "snapshot", headshots: "headshot",
  snapping: "snap", taking: "take", sending: "send", sharing: "share", showing: "show", seeing: "see",
  generating: "generate", creating: "create", capturing: "capture", shooting: "shoot",
  wearing: "wear", dressed: "dress", dressing: "dress", picked: "pick",
  chose: "choose", chosen: "choose", selected: "select",
};

export function normalizeIntentText(content: string): string {
  const contractions: Record<string, string> = {
    "i'd": "i would", "i'll": "i will", "i'm": "i am", "you're": "you are",
    "you've": "you have", "you'll": "you will", "don't": "do not", "can't": "cannot",
    "won't": "will not", "wouldn't": "would not", "couldn't": "could not",
    "what's": "what is", "let's": "let us",
  };
  return content.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase()
    .replace(/\b(?:i'd|i'll|i'm|you're|you've|you'll|don't|can't|won't|wouldn't|couldn't|what's|let's)\b/g, word => contractions[word])
    .replace(/\bclose[- ]up\b/g, "closeup");
}

function words(content: string): string[] {
  return (normalizeIntentText(content).match(/[a-z]+(?:'[a-z]+)?/g) ?? []).map(word => LEMMAS[word] ?? word);
}

export function visibleImageIntentText(content: string): string {
  return content.replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”/g, " ");
}

function photoIndex(tokens: string[]): number {
  return tokens.findIndex(token => PHOTO.has(token));
}

function outfitTarget(tokens: string[]): boolean {
  const outfit = tokens.some(token => OUTFIT.has(token));
  const look = tokens.includes("look") &&
    tokens.some(token => ["your", "today's", "tonight's", "current", "chosen"].includes(token));
  const fit = tokens.includes("fit") && tokens.some(token => token === "check" || PHOTO.has(token));
  const dressing = tokens.some(token => token === "wear" || token === "dress") && tokens.includes("you");
  return fit || look || dressing || (outfit && (
    tokens.includes("your") || tokens.includes("ren") || tokens.includes("ren's") ||
    tokens.some(token => ["today's", "tonight's", "current"].includes(token)) ||
    (tokens.includes("you") && tokens.some(token => ["pick", "choose", "select", "wear", "dress"].includes(token)))
  ));
}

function appearanceTarget(tokens: string[]): boolean {
  const ownedBody = tokens.includes("your") && tokens.some(token => SELF_BODY.has(token));
  const looksLike = tokens.includes("you") && tokens.includes("look") && tokens.includes("like");
  const viewedSelf = tokens.some((token, index) => VIEW.has(token) &&
    tokens.slice(index + 1, index + 6).some(object => object === "you" || object === "yourself"));
  return ownedBody || looksLike || viewedSelf || tokens.includes("yourself");
}

/** The primary subject of "of/showing/depicting", not secondary viewer pronouns. */
function depictedSubject(tokens: string[], imageIndex: number): "assistant" | "other" | null {
  if (imageIndex < 0) return null;
  const tail = tokens.slice(imageIndex + 1);
  const relation = tail.findIndex(token => ["of", "show", "depicting", "depict"].includes(token));
  if (relation < 0) {
    // Prenominal subjects count too: "a cat photo" isn't a photo of Ren.
    const prefix = tokens.slice(0, imageIndex);
    const boundaries = new Set([...ACTION, "want", "need", "like", "love", "appreciate", "a", "an", "the", "another"]);
    let boundary = -1;
    for (let index = prefix.length - 1; index >= 0; index--) {
      if (boundaries.has(prefix[index])) { boundary = index; break; }
    }
    const modifiers = prefix.slice(boundary + 1).filter(token =>
      !["me", "us", "for", "this", "that", "one", "more", "quick", "recent", "new", "fresh", "additional",
        "different", "current", "beautiful", "nice", "lovely", "little", "daily", "latest"].includes(token));
    if (!modifiers.length) return null;
    if (modifiers.every(token => ["your", "ren", "ren's", "fit"].includes(token)) ||
        (modifiers.includes("your") && modifiers.some(token => OUTFIT.has(token)))) return "assistant";
    return "other";
  }
  const subject = tail.slice(relation + 1).filter(token => !["a", "an", "the"].includes(token));
  if (["you", "yourself", "ren"].includes(subject[0])) return "assistant";
  if ((subject[0] === "your" || subject[0] === "ren's") &&
      (OUTFIT.has(subject[1]) || SELF_BODY.has(subject[1]) || subject[1] === "look")) return "assistant";
  // "Showing me what you're wearing" describes the viewer plus Ren's outfit.
  if (subject[0] === "me" && subject.includes("what") && outfitTarget(subject)) return "assistant";
  if (OUTFIT.has(subject[0]) && outfitTarget(subject)) return "assistant";
  return "other";
}

/** Recognize the request speech act independently of its visual object. */
function requestAct(tokens: string[], raw: string): boolean {
  const body = [...tokens];
  while (POLITE.has(body[0])) body.shift();
  if (body[0] === "for" && ["me", "us"].includes(body[1])) body.splice(0, 2);
  while (POLITE.has(body[0])) body.shift();
  if (!body.length) return false;
  const head = body[0];
  if (MODAL.has(head) && ["you", "i", "we"].includes(body[1])) {
    return body.slice(2).some(token => ACTION.has(token));
  }
  if (head === "i") {
    return ["want", "need", "wish"].includes(body[1]) ||
      (body[1] === "would" && ["like", "love", "appreciate"].includes(body[2]));
  }
  if (head === "let" && ["me", "us"].includes(body[1])) return body.slice(2).some(token => ACTION.has(token));
  if (head === "mind") return body.slice(1).some(token => ACTION.has(token));
  if (head === "do" && body[1] === "you") return body.slice(2).some(token => token === "have" || token === "get");
  if (head === "got" || (head === "have" && body[1] === "you")) return true;
  if (head === "are" && body[1] === "you" && body.some(token => ["ready", "able", "willing"].includes(token))) {
    return body.some(token => ACTION.has(token));
  }
  // Gerund/past-tense descriptions aren't imperatives.
  if (ACTION.has(head) && !/^\s*(?:taking|snapping|sending|sharing|showing|sent|took|shared|showed)\b/i.test(raw)) return true;
  const nounPhrase = body[0] === "a" || body[0] === "an" ? body.slice(1) : body;
  return (PHOTO.has(nounPhrase[0]) || ["another", "more", "one", "different"].includes(nounPhrase[0])) &&
    (tokens.includes("please") || tokens.includes("another") ||
      (tokens.includes("one") && tokens.includes("more")) ||
      (PHOTO.has(nounPhrase[0]) && tokens.includes("for") && tokens.includes("me")));
}

function generationVeto(content: string, tokens: string[]): boolean {
  const normalized = normalizeIntentText(content);
  if (/\b(?:do not|not to|never|cannot|will not|would not|could not)\s+(?:please\s+)?(?:send|share|show|take|snap|generate|create|make|give)\b/.test(normalized)) return true;
  if (/\b(?:do not|would not)\s+(?:want|like|need)\b/.test(normalized) ||
      /\bno\s+(?:more\s+)?(?:selfies?|photos?|pictures?|pics?|images?)\b/.test(normalized)) return true;
  if (tokens.some((token, index) => ["not", "avoid", "stop", "skip", "cancel"].includes(token) &&
      ACTION.has(tokens[index + 1]))) return true;
  return false;
}

function blockedRequest(content: string, tokens: string[]): boolean {
  const normalized = normalizeIntentText(content);
  if (generationVeto(content, tokens)) return true;
  if (/\b(?:she|he|they|someone)\s+(?:said|asked|promised|told)\b/.test(normalized)) return true;
  if (/^\s*(?:how|why)\b/.test(normalized) ||
      /\bhow\s+(?:to|(?:can|do|should|would)\s+(?:i|we|someone))\b/.test(normalized)) return true;
  const explain = tokens.findIndex(token => EXPLAIN.has(token) || INSPECT.has(token));
  const action = tokens.findIndex(token => ACTION.has(token));
  if (explain >= 0 && (action < 0 || explain < action)) return true;
  const artifact = tokens.findIndex(token => TEXT_ARTIFACT.has(token));
  if (artifact >= 0 && photoIndex(tokens) < 0 &&
      !tokens.slice(0, artifact).some(token => ["in", "at", "with", "while"].includes(token))) return true;
  const existing = /\b(?:uploaded|attached|existing|previous)\s+(?:image|photo|picture|pic|selfie)\b/.test(normalized);
  return existing && !tokens.some(token => CAPTURE.has(token));
}

function empty(clause: string, blocked = false): SemanticImageIntent {
  return { target: "none", kind: "appearance", framing: "image", repeat: false, differentAngle: false, closeUp: false, blocked, clause };
}

function continuation(tokens: string[]): "repeat" | "continue" | null {
  const repeat = tokens.includes("another") || (tokens.includes("one") && tokens.includes("more")) ||
    (tokens.includes("angle") && tokens.some(token => token === "different" || token === "another"));
  const allowed = new Set([...POLITE, ...MODAL, ...ACTION,
    "are", "you", "i", "we", "me", "us", "it", "that", "the", "my", "a", "an",
    "one", "more", "another", "different", "angle", "from", "at", "to", "mind",
    "ready", "now", "yet", "go", "ahead", "do", "try", "again", "what", "how", "about", "let",
    "is", "like", "want", "need", "appreciate",
    ...PHOTO]);
  if (!tokens.length || tokens.some(token => !allowed.has(token))) return null;
  if (repeat) return "repeat";
  if (tokens.includes("ready") || tokens.some(token => ["yes", "okay", "ok", "sure"].includes(token)) ||
      tokens.includes("please") || tokens.includes("ahead") || tokens.includes("again") ||
      (tokens.some(token => VIEW.has(token) || RECEIVE.has(token)) &&
        (tokens.includes("it") || tokens.includes("that") || !tokens.some(token => PHOTO.has(token)))) ||
      (tokens.includes("about") && tokens.some(token => PHOTO.has(token)))) return "continue";
  return null;
}

export function classifySemanticImageIntent(content: string): SemanticImageIntent {
  const visible = visibleImageIntentText(content);
  const allTokens = words(visible);
  if (generationVeto(visible, allTokens)) return empty(content, true);
  // A relation fragment belongs to the preceding visual request, not a new
  // unqualified Ren photo ("send a picture. Of a crow").
  const clauses: string[] = [];
  for (const clause of visible.split(/[.!?;\n]+/).map(value => value.trim()).filter(Boolean)) {
    if (/^(?:of|showing|depicting)\b/i.test(clause) && clauses.length) clauses[clauses.length - 1] += ` ${clause}`;
    else clauses.push(clause);
  }
  let blockedClause = false;
  for (const clause of clauses) {
    const tokens = words(clause);
    if (blockedRequest(clause, tokens)) {
      blockedClause = true;
      continue;
    }
    if (!requestAct(tokens, clause)) continue;
    const imageIndex = photoIndex(tokens);
    const subject = depictedSubject(tokens, imageIndex);
    const outfit = outfitTarget(tokens);
    const appearance = appearanceTarget(tokens);
    const fit = tokens.includes("fit") && tokens.some(token => token === "check" || PHOTO.has(token));
    if (subject === "other") return { ...empty(clause), target: "other" };
    if (imageIndex < 0 && !outfit && !appearance && !fit) continue;
    if (subject === null && imageIndex >= 0 &&
        tokens.slice(0, imageIndex).some(token => token === "this" || token === "that")) {
      return { ...empty(clause), target: "previous_image" };
    }
    // Bare "show a schedule/book" has no photo or personal visual target.
    return {
      target: "assistant", kind: outfit || fit ? "outfit" : "appearance",
      framing: tokens.includes("selfie") ? "selfie" :
        tokens.some(token => ["portrait", "headshot", "closeup"].includes(token)) ? "portrait" : "image",
      repeat: tokens.includes("another") || (tokens.includes("one") && tokens.includes("more")),
      differentAngle: tokens.includes("angle") && tokens.some(token => token === "different" || token === "another"),
      closeUp: tokens.some(token => token === "closeup" || token === "headshot"),
      blocked: false, clause,
    };
  }
  if (blockedClause) return empty(content, true);
  const followUp = continuation(allTokens);
  return followUp ? {
    ...empty(content), target: "previous_image", repeat: followUp === "repeat",
    differentAngle: allTokens.includes("angle"),
  } : empty(content);
}

export function isAssistantImageOffer(content: string): boolean {
  return visibleImageIntentText(content).split(/[.!?;\n]+/).some(text => {
    const tokens = words(text);
    if (blockedRequest(text, tokens) || depictedSubject(tokens, photoIndex(tokens)) === "other") return false;
    const visual = photoIndex(tokens) >= 0 || outfitTarget(tokens);
    const delivery = tokens.some(token => ACTION.has(token));
    const offer = /\bi\s+(?:will|can|am going to)\b|\blet me\b|\b(?:would|do)\s+you\s+(?:like|want)\b|\b(?:shall|should)\s+i\b/.test(normalizeIntentText(text));
    return visual && delivery && offer;
  });
}

/** An acknowledgement keeps context; it does not itself authorize generation. */
export function referencesCurrentImage(content: string): boolean {
  const text = visibleImageIntentText(content);
  const tokens = words(text);
  if (!tokens.length || blockedRequest(text, tokens)) return false;
  if (depictedSubject(tokens, photoIndex(tokens)) === "other") return false;
  if (photoIndex(tokens) >= 0 || outfitTarget(tokens) || appearanceTarget(tokens)) return true;
  const acknowledgement = new Set(["thanks", "thank", "you", "i", "love", "like", "it", "that",
    "lovely", "beautiful", "perfect", "nice", "wow", "great", "baby", "babe"]);
  return tokens.every(token => acknowledgement.has(token));
}
