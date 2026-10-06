/**
 * Kindroid prose is not a tool invocation. Only the dispatcher can establish
 * image progress/completion; never persist a contradictory status claim.
 */
export function enforceImageDeliveryStatus(content: string, imageAttached: boolean): string {
  const renderingClaim = /\bservers?\s+(?:are|is)\s+(?:still\s+)?rendering\b/i.test(content) ||
    /\b(?:I['’]m|I am|we['’]re|we are)\s+(?:currently\s+|still\s+)?rendering\b/i.test(content) ||
    /\b(?:I['’]m|I am|we['’]re|we are)\s+(?:currently\s+|still\s+)?(?:generating|rendering|processing)\s+(?:(?:your|my|the|an?)\s+)?(?:image|picture|photo|selfie|portrait)\b/i.test(content) ||
    /\b(?:your|my|the)\s+(?:image|picture|photo|selfie|portrait)\s+(?:is being|is)\s+(?:still\s+)?(?:rendering|generated|generating|processing)\b/i.test(content);
  const futureDelivery = /\bI(?:['’]ll| will)\s+(?:send|attach|share)\s+(?:you\s+)?(?:(?:an?|the|my|your)\s+)?(?:image|picture|photo|selfie|portrait)\b/i.test(content);
  if (imageAttached && (renderingClaim || futureDelivery)) {
    return "Here’s your picture—it’s attached to this message.";
  }
  if (!imageAttached && renderingClaim) {
    return "No image generation has started for this message. Please ask me directly to send a picture.";
  }
  return content;
}
