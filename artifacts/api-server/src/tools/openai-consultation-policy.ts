const TECHNICAL_ACTION =
  /\b(?:debug|debugging|troubleshoot|troubleshooting|diagnose|diagnosing|investigate|fix|resolve|identify|determine|design|implement|explain why)\b/i;

const TECHNICAL_FAILURE =
  /\b(?:error|exception|stack trace|build failure|build failed|failing tests?|test failure|crash|timeout|timed out|memory leak|race condition|deadlock|dependency conflict|authentication failure|authorization failure|webhook failure|integration failure|deployment failure|network failure|database failure|query plan|http [45]\d\d)\b/i;

const COMPLEX_TECHNICAL_TOPIC =
  /\b(?:system architecture|software architecture|migration strategy|distributed system|concurrency|performance bottleneck|threat model|security vulnerability|database migration|api integration|oauth flow|data consistency)\b/i;

const WEB_SOURCE_SYNTHESIS =
  /\b(?:synthesize|cross-check|reconcile|weigh|assess)\b[^.!?\n]{0,80}\b(?:sources?|reports?|claims?|evidence|findings)\b|\bcompare\s+(?:the\s+)?(?:sources?|reports?|claims?|findings)|\bwhat\s+do\s+(?:the\s+)?sources?\s+(?:agree|disagree)\s+(?:on|about)|\bbased\s+on\s+(?:these|the)\s+sources?\b/i;

export type AutomaticConsultationInput = {
  message: string;
  localToolHandled: boolean;
  hasWebResults: boolean;
};

export function shouldAutomaticallyConsultOpenAI({
  message,
  localToolHandled,
  hasWebResults,
}: AutomaticConsultationInput): boolean {
  if (localToolHandled) return false;

  const technicalReasoningNeeded =
    TECHNICAL_ACTION.test(message) &&
    (TECHNICAL_FAILURE.test(message) || COMPLEX_TECHNICAL_TOPIC.test(message));
  const webSynthesisNeeded =
    hasWebResults && WEB_SOURCE_SYNTHESIS.test(message);

  return technicalReasoningNeeded || webSynthesisNeeded;
}