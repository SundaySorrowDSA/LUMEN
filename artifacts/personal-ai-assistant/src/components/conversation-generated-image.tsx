import { useState } from 'react';

export function ConversationGeneratedImage({ conversationId, messageId, metadata }: {
  conversationId: number; messageId: number; metadata: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  let prompt: string | null = null;
  try {
    const image = JSON.parse(metadata ?? '{}').generatedImage;
    if (image && typeof image.prompt === 'string' && typeof image.objectPath === 'string') prompt = image.prompt;
  } catch { /* Ordinary messages have no generated image. */ }
  if (prompt === null) return null;
  const src = `${import.meta.env.BASE_URL}api/assistant/conversations/${conversationId}/messages/${messageId}/image${retry ? `?retry=${retry}` : ''}`;
  return <figure className="mb-3" data-testid={`conversation-image-${messageId}`}>
    {!failed && <a href={src} target="_blank" rel="noreferrer" aria-label="Open generated image full size">
      <img src={src} alt={`Generated image: ${prompt}`} className="max-h-96 w-full rounded-lg object-contain" onError={() => setFailed(true)} />
    </a>}
    {failed && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs text-destructive">
      The saved image could not be loaded.
      <button type="button" onClick={() => { setRetry((value) => value + 1); setFailed(false); }} className="ml-2 underline">Retry loading</button>
    </div>}
    <figcaption className="mt-1 text-[10px] text-muted-foreground">Generated image · saved with this thread</figcaption>
  </figure>;
}
