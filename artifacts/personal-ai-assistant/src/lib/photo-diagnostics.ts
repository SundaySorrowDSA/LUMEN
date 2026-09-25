export type PhotoSource = 'paste' | 'picker';
export type PhotoSaveStatus = 'pending' | 'saved' | 'failed';

export type PhotoDiagnostic = {
  source?: PhotoSource;
  pasteRepresentation?: 'items' | 'files';
  compressedAtSend?: boolean;
  save?: PhotoSaveStatus;
  sentAt?: number;
  dismissed?: boolean;
};

type DiagnosticStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storageKey = (conversationId: number) => `lumen-photo-diagnostics:${conversationId}`;

function metadataOnly(value: unknown): PhotoDiagnostic {
  if (!value || typeof value !== 'object') return {};
  const record = value as PhotoDiagnostic;
  return {
    ...(record.source === 'paste' || record.source === 'picker' ? { source: record.source } : {}),
    ...(record.pasteRepresentation === 'items' || record.pasteRepresentation === 'files'
      ? { pasteRepresentation: record.pasteRepresentation } : {}),
    ...(typeof record.compressedAtSend === 'boolean' ? { compressedAtSend: record.compressedAtSend } : {}),
    ...(record.save === 'pending' || record.save === 'saved' || record.save === 'failed' ? { save: record.save } : {}),
    ...(typeof record.sentAt === 'number' && Number.isFinite(record.sentAt) ? { sentAt: record.sentAt } : {}),
    ...(record.dismissed === true ? { dismissed: true } : {}),
  };
}

export function readPhotoDiagnostics(conversationId: number, storage?: DiagnosticStorage): Record<number, PhotoDiagnostic> {
  try {
    const parsed: unknown = JSON.parse((storage ?? window.localStorage).getItem(storageKey(conversationId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([id]) => /^\d+$/.test(id)).map(([id, value]) => [id, metadataOnly(value)]),
    );
  } catch {
    return {};
  }
}

export function updatePhotoDiagnostic(
  conversationId: number,
  messageId: number,
  patch: PhotoDiagnostic,
  storage?: DiagnosticStorage,
): PhotoDiagnostic {
  const records = readPhotoDiagnostics(conversationId, storage);
  const next = metadataOnly({ ...records[messageId], ...patch });
  try {
    (storage ?? window.localStorage).setItem(
      storageKey(conversationId),
      JSON.stringify({ ...records, [messageId]: next }),
    );
  } catch {
    // The current page can still display the returned metadata when local storage is unavailable.
  }
  return next;
}

export function deletePhotoDiagnostics(conversationId: number, storage?: DiagnosticStorage): void {
  try {
    (storage ?? window.localStorage).removeItem(storageKey(conversationId));
  } catch {
    // The conversation is already deleted; do not block its existing photo cleanup.
  }
}