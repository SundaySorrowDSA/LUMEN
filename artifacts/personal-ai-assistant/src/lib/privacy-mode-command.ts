export function privacyModeCommand(text: string): boolean | null {
  const command = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  if (/^(?:hey lumen[, ]+)?(?:dark mode|go dark|silent mode|silent mode activated|hush mode|turn on dark mode|activate dark mode)(?: please)?$/.test(command)) return true;
  if (/^(?:hey lumen[, ]+)?(?:all clear|clear mode|resume notifications|end dark mode|turn off dark mode|activate all clear)(?: please)?$/.test(command)) return false;
  return null;
}
