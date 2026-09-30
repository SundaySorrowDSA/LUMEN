const REQUEST =
  /(?:ask\s+(?:openai|chatgpt)|consult\s+(?:with\s+)?openai)\b/i;
const DIRECT_REQUEST =
  /^(?:(?:hey[, ]+\s*)?(?:ren|lumen)[,!:]?\s*)?(?:(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need)\s+you\s+to\s+|(?:i(?:'d|\s+would)\s+like\s+you\s+to\s+)|please\s+)?(?:ask\s+(?:openai|chatgpt)|consult\s+(?:with\s+)?openai)\b[\s:,-]*/i;
const SUFFIX_REQUEST =
  /\s+(?:please\s+)?(?:ask\s+(?:openai|chatgpt)|consult\s+(?:with\s+)?openai)[.!?]?\s*$/i;
const REN_FOLLOW_UP =
  /(?:[.!?]\s+|,\s*)then\s+(?:(?:you|ren)\s+)?(?:pick|tell|explain|summarize|respond)\b/i;
const TECHNICAL_PROBLEM =
  /\b(?:debug(?:ging)?|diagnos(?:e|is|ing)|troubleshoot(?:ing)?|stack trace|exception|crash|tim(?:e|ing)\s*out|failure|failing|error|why\s+(?:does|is|did|doesn't|isn't))\b/i;
const TECHNICAL_CONTEXT =
  /\b(?:api|oauth|integration|authentication|authorization|database|server|deployment|typescript|javascript|python|runtime|network|request|endpoint|http|ssl|tls|code|software|stack trace|exception|crash)\b/i;
const SOURCE_SYNTHESIS_REQUEST =
  /\b(?:compare|cross[- ]check|reconcile|synthesize|weigh)\b/i;
const MULTIPLE_SOURCE_CONTEXT =
  /\b(?:(?:these|both|multiple|several)\s+)(?:sources|articles|links|studies|reports|claims)\b/i;

export type OpenAIConsultationAssessment =
  | { decision: "explicit_request"; reason: "handled_by_explicit_tool" }
  | { decision: "recommend"; reason: "technical_diagnosis" | "multi_source_synthesis" }
  | { decision: "skip"; reason: "local_tool_handled" | "no_clear_need" };

/** Signals clear future consultation candidates without invoking any provider. */
export function assessOpenAIConsultation(input: {
  message: string;
  explicitRequest: boolean;
  localToolHandled: boolean;
  webResultCount: number;
}): OpenAIConsultationAssessment {
  if (input.explicitRequest) {
    return { decision: "explicit_request", reason: "handled_by_explicit_tool" };
  }
  if (input.localToolHandled) {
    return { decision: "skip", reason: "local_tool_handled" };
  }
  if (TECHNICAL_PROBLEM.test(input.message) && TECHNICAL_CONTEXT.test(input.message)) {
    return { decision: "recommend", reason: "technical_diagnosis" };
  }
  if (
    SOURCE_SYNTHESIS_REQUEST.test(input.message) &&
    (input.webResultCount >= 2 || MULTIPLE_SOURCE_CONTEXT.test(input.message))
  ) {
    return { decision: "recommend", reason: "multi_source_synthesis" };
  }
  return { decision: "skip", reason: "no_clear_need" };
}

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