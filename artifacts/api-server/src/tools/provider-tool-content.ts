/** Only a completed helper's factual content is eligible for the KN message.
 * Failed-tool status, reasons, and fallback text remain in LUMEN metadata/logs.
 */
export function appendSuccessfulConsultation(
  baseContent: string,
  userContent: string,
  outcome: {
    providerContent: string;
    consultation: { requested: boolean; status?: string };
  },
): string {
  return outcome.consultation.requested && outcome.consultation.status === "completed"
    ? `${baseContent}\n\n${outcome.providerContent.slice(userContent.length)}`
    : baseContent;
}
