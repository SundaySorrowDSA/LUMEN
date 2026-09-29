const REQUEST =
  /(?:ask\s+(?:openai|chatgpt)|consult\s+(?:with\s+)?openai)\b/i;
const DIRECT_REQUEST =
  /^(?:(?:hey[, ]+\s*)?(?:ren|lumen)[,!:]?\s*)?(?:(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need)\s+you\s+to\s+|(?:i(?:'d|\s+would)\s+like\s+you\s+to\s+)|please\s+)?(?:ask\s+(?:openai|chatgpt)|consult\s+(?:with\s+)?openai)\b[\s:,-]*/i;
const SUFFIX_REQUEST =
  /\s+(?:please\s+)?(?:ask\s+(?:openai|chatgpt)|consult\s+(?:with\s+)?openai)[.!?]?\s*$/i;
const REN_FOLLOW_UP =
  /(?:[.!?]\s+|,\s*)then\s+(?:(?:you|ren)\s+)?(?:pick|tell|explain|summarize|respond)\b/i;

/** Null means no explicit request; an empty string means the user gave no task. */
export function extractExplicitOpenAIQuestion(content: string): string | null {
  if (!REQUEST.test(content)) return null;
  const direct = DIRECT_REQUEST.exec(content);
  if (direct) return content.slice(direct[0].length).split(REN_FOLLOW_UP)[0].trim().slice(0, 2_000);
  if (SUFFIX_REQUEST.test(content)) {
    return content.replace(SUFFIX_REQUEST, "").trim().slice(0, 2_000);
  }
  return null;
}