import { X } from 'lucide-react';
import type { PhotoDiagnostic } from '@/lib/photo-diagnostics';

export function PhotoDiagnosticDetail({
  conversationId,
  messageId,
  diagnostic,
  lookup,
  onDismiss,
}: {
  conversationId: number;
  messageId: number;
  diagnostic?: PhotoDiagnostic;
  lookup: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-black/15 bg-black/10 px-2 py-1.5 text-[10px] leading-4 text-primary-foreground/90" data-testid={`photo-diagnostic-${messageId}`}>
      <div className="flex items-center justify-between gap-2 font-medium">
        <span>Photo check · this device only</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss photo diagnostic" className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" data-testid={`dismiss-photo-diagnostic-${messageId}`}><X size={13} /></button>
      </div>
      <div>Source: {diagnostic?.source === 'paste' ? 'Clipboard paste' : diagnostic?.source === 'picker' ? 'Photo picker' : 'Unknown (earlier send)'}</div>
      {diagnostic?.source === 'paste' && <div>Paste input: {diagnostic.pasteRepresentation === 'items' ? 'Clipboard items' : diagnostic.pasteRepresentation === 'files' ? 'Clipboard files' : 'Unknown'}</div>}
      <div>Conversation {conversationId} · message {messageId}</div>
      <div>Conversion complete before send: {diagnostic?.compressedAtSend === undefined ? 'Unknown' : diagnostic.compressedAtSend ? 'Yes' : 'No'} · Save: {diagnostic?.save ?? 'Unknown'}</div>
      <div>Later local lookup: {lookup}</div>
    </div>
  );
}