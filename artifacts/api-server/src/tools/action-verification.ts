import {
  parseActionSpans, type ActionToolId, type VerifiedActionSpan,
} from "@workspace/assistant-providers/action-text";
import type { WebSearchResponse } from "./web-search.js";
import type { WorkScheduleResult } from "./work-schedule.js";
import type { CalculationResult } from "./calculator.js";
import type { ReminderToolResult } from "./reminders.js";

type ActionEvidence = {
  toolId: ActionToolId;
  operation?: "created" | "cancelled" | "listed";
  imageFraming?: "selfie" | "portrait";
};

/** Only actual successful results from this response are eligible. Merely
 * requesting a tool, failed consultation, and ambiguous reminders are not.
 */
export function collectSuccessfulActionEvidence(outcomes: {
  webSearch?: WebSearchResponse | null;
  workSchedule?: WorkScheduleResult | null;
  calculation?: CalculationResult | null;
  reminder?: ReminderToolResult | null;
  photoAnalyzed?: boolean;
  consultation?: { requested: boolean; status?: string };
}): ActionEvidence[] {
  const evidence: ActionEvidence[] = [];
  if (outcomes.webSearch?.results.length) evidence.push({ toolId: outcomes.webSearch.tool });
  if (outcomes.workSchedule) evidence.push({ toolId: outcomes.workSchedule.tool });
  if (outcomes.calculation && Number.isFinite(outcomes.calculation.result)) evidence.push({ toolId: outcomes.calculation.tool });
  if (outcomes.photoAnalyzed) evidence.push({ toolId: "photo-analysis" });
  if (outcomes.consultation?.requested && outcomes.consultation.status === "completed") {
    evidence.push({ toolId: "consult_openai" });
  }
  const reminder = outcomes.reminder;
  if (reminder && (reminder.status === "listed" ||
      (["created", "cancelled"].includes(reminder.status) && reminder.reminders.length > 0))) {
    evidence.push({ toolId: reminder.tool, operation: reminder.status as ActionEvidence["operation"] });
  }
  return evidence;
}

/** Deliberately bounded operation grammar, not arbitrary keyword similarity.
 * The WHOLE action must describe the operation. Extra claims, other actors,
 * future/negated/hypothetical wording, and embodied actions fail closed.
 * Specific dates, amounts, recipients or targets not checked here also fail
 * closed rather than borrowing evidence for a different operation.
 */
function corresponds(text: string, evidence: ActionEvidence): boolean {
  const action = text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase().trim().replace(/\s+/g, " ")
    .replace(/[.!]$/, "")
    .replace(/^i(?: have|'ve)?\s+/, "");
  const object = "(?:(?:the|your|this|that|a|an)\\s+)?";
  switch (evidence.toolId) {
    case "when-i-work-calendar":
      return new RegExp(`^(?:check(?:s|ed|ing)?|look(?:s|ed|ing)? (?:at|over)|review(?:s|ed|ing)?|read(?:s|ing)?) ${object}(?:(?:work|shift) )?(?:schedule|calendar)$`).test(action);
    case "safe-calculator":
      return /^(?:calculat(?:e|es|ed|ing)|work(?:s|ed|ing)? out|run(?:s|ning)?|ran) (?:the |your )?(?:numbers|calculation|total|result|sum)$/.test(action);
    case "persistent-reminders":
      if (evidence.operation === "created") {
        return new RegExp(`^(?:set(?:s|ting)?|creat(?:e|es|ed|ing)) ${object}reminder(?: for you)?$`).test(action);
      }
      if (evidence.operation === "cancelled") {
        return new RegExp(`^(?:cancel(?:s|led|ed|ling|ing)?|remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing)) ${object}reminder$`).test(action);
      }
      return evidence.operation === "listed" &&
        new RegExp(`^(?:list(?:s|ed|ing)?|check(?:s|ed|ing)?|review(?:s|ed|ing)?) ${object}(?:pending )?reminders$`).test(action);
    case "bing-rss-web-search":
      return /^(?:(?:search(?:es|ed|ing)?|check(?:s|ed|ing)?) (?:the (?:web|internet)|online)|look(?:s|ed|ing)? (?:it|this|that|something) up (?:online|on the web))$/.test(action);
    case "photo-analysis":
      return new RegExp(`^(?:examin(?:e|es|ed|ing)|analy[sz](?:e|es|ed|ing)|inspect(?:s|ed|ing)?|look(?:s|ed|ing)? at) ${object}(?:(?:attached|uploaded) )?(?:photo|picture|image)$`).test(action);
    case "consult_openai":
      return /^(?:ask(?:s|ed|ing)?|consult(?:s|ed|ing)?) (?:the )?(?:openai|oracle)$/.test(action);
    case "generate_image":
      return new RegExp(`^(?:generat(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|show(?:s|ed|ing|n)?|send(?:s|ing)?|sent|shar(?:e|es|ed|ing)|attach(?:es|ed|ing)?) (?:you )?${object}(?:generated )?(?:image|picture|photo${evidence.imageFraming ? `|${evidence.imageFraming}` : ""})(?: to you)?$`).test(action);
  }
}

export function verifyActionSpans(content: string, evidence: readonly ActionEvidence[]): VerifiedActionSpan[] {
  return parseActionSpans(content).flatMap(span => {
    const supporting = evidence.find(event => corresponds(span.text, event));
    return supporting ? [{ ...span, toolId: supporting.toolId, status: "verified" as const }] : [];
  });
}
