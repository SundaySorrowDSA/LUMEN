import { useEffect, useRef, useState } from 'react';
import { generateTestImage } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';

/** Temporary proof of concept: no conversation mutations, query cache, or persistence. */
export function TestImageControl() {
  const [prompt, setPrompt] = useState('A small black crow standing on a gold coin, cinematic lighting.');
  const [imagePrompt, setImagePrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const releaseImage = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setImageUrl(null);
  };

  useEffect(() => () => {
    requestRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const runTest = async () => {
    if (requestRef.current) return;
    const enteredPrompt = prompt.trim();
    if (!enteredPrompt) {
      setError('Please enter a non-empty image prompt.');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError(null);
    releaseImage();
    try {
      const image = await generateTestImage({ prompt: enteredPrompt }, {
        responseType: 'blob',
        headers: { Accept: 'image/png' },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!(image instanceof Blob) || image.type !== 'image/png' || image.size === 0) {
        throw new Error('The image endpoint did not return a PNG. Please try again.');
      }
      const url = URL.createObjectURL(image);
      urlRef.current = url;
      setImagePrompt(enteredPrompt);
      setImageUrl(url);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Could not generate an image. Please try again.');
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setPending(false);
      }
    }
  };

  return (
    <section
      aria-label="Temporary image generation test"
      className="shrink-0 border-b border-border bg-primary/[.04] px-5 py-2 sm:px-8"
      data-testid="test-image-control"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 font-mono text-xs font-semibold text-primary">TEST IMAGE</span>
        <span className="text-[11px] text-muted-foreground">Temporary test · not saved to chat</span>
        {(imageUrl || error) && !pending && (
          <button
            type="button"
            onClick={() => { releaseImage(); setError(null); }}
            className="min-h-11 px-2 text-xs text-muted-foreground underline"
            data-testid="button-dismiss-test-image"
          >
            Dismiss
          </button>
        )}
      </div>
      <form className="mt-2 flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void runTest(); }}>
        <label htmlFor="test-image-prompt" className="sr-only">Image prompt</label>
        <textarea
          id="test-image-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={pending}
          rows={2}
          placeholder="Describe the image to generate"
          className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-base leading-5 text-foreground outline-none focus:border-primary disabled:opacity-60"
          data-testid="input-test-image-prompt"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary disabled:opacity-60"
          data-testid="button-test-image"
        >
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          Generate
        </button>
      </form>
      {pending && (
        <p role="status" className="mt-2 text-xs text-muted-foreground" data-testid="test-image-loading">
          Generating one image… This may take up to two minutes.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 max-h-24 overflow-y-auto break-words text-xs text-destructive" data-testid="test-image-error">
          Image generation failed: {error}
        </p>
      )}
      {imageUrl && (
        <figure className="mt-2" data-testid="test-image-result">
          <img
            src={imageUrl}
            alt={`Generated test image: ${imagePrompt}`}
            className="mx-auto max-h-[min(30dvh,260px)] max-w-full rounded-lg object-contain"
            onError={() => {
              releaseImage();
              setError('The returned image could not be displayed. Please try again.');
            }}
          />
          <figcaption role="status" className="mt-1 text-center text-[11px] text-muted-foreground">
            One image generated · temporary preview only
          </figcaption>
        </figure>
      )}
    </section>
  );
}
