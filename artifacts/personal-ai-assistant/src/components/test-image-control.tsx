import { useEffect, useRef, useState } from 'react';
import { generateTestImage, type OpenAiImageError } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { readTestImageError } from '@/lib/test-image-errors';

/** Temporary proof of concept: no conversation mutations, query cache, or persistence. */
export function TestImageControl() {
  const [prompt, setPrompt] = useState('A small black crow standing on a gold coin, cinematic lighting.');
  const [imagePrompt, setImagePrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openaiError, setOpenaiError] = useState<OpenAiImageError | null>(null);
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
      setOpenaiError(null);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError(null);
    setOpenaiError(null);
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
        setOpenaiError(readTestImageError(failure));
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setPending(false);
      }
    }
  };

  return (
    <details className="shrink-0 border-b border-border bg-background" data-testid="dev-tools">
      <summary className="cursor-pointer px-5 py-2.5 text-xs text-muted-foreground sm:px-8" data-testid="button-dev-tools">
        Dev Tools · Image Sandbox
      </summary>
    <section
      aria-label="Temporary image generation test"
      className="max-h-[55dvh] overflow-y-auto bg-primary/[.04] px-5 py-2 sm:px-8"
      data-testid="test-image-control"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 font-mono text-xs font-semibold text-primary">TEST IMAGE</span>
        <span className="text-[11px] text-muted-foreground">Temporary test · not saved to chat</span>
        {(imageUrl || error) && !pending && (
          <button
            type="button"
            onClick={() => { releaseImage(); setError(null); setOpenaiError(null); }}
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
        <div role="alert" className="mt-2 max-h-[30dvh] overflow-y-auto break-words text-xs text-destructive" data-testid="test-image-error">
          <p>Image generation failed: {error}</p>
          {openaiError && (
            <dl className="mt-2 space-y-1 whitespace-pre-wrap" data-testid="test-image-openai-error">
              <div><dt className="inline font-semibold">OpenAI HTTP status: </dt><dd className="inline">{openaiError.status}</dd></div>
              <div><dt className="inline font-semibold">Message: </dt><dd className="inline">{openaiError.message}</dd></div>
              <div><dt className="inline font-semibold">Code: </dt><dd className="inline">{openaiError.code ?? '(not provided)'}</dd></div>
              <div><dt className="inline font-semibold">Type: </dt><dd className="inline">{openaiError.type ?? '(not provided)'}</dd></div>
              <div><dt className="inline font-semibold">Param: </dt><dd className="inline">{openaiError.param ?? '(not provided)'}</dd></div>
            </dl>
          )}
        </div>
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
    </details>
  );
}
