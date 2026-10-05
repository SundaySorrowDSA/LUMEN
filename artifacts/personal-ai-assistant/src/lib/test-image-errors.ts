import type { OpenAiImageError } from '@workspace/api-client-react';

/** Only accept structured development diagnostics returned by the test endpoint. */
export function readTestImageError(failure: unknown): OpenAiImageError | null {
  if (!failure || typeof failure !== 'object' || !('data' in failure)) return null;
  const data = failure.data;
  if (!data || typeof data !== 'object' || !('openaiError' in data)) return null;
  const error = data.openaiError;
  if (!error || typeof error !== 'object') return null;
  const value = error as Record<string, unknown>;
  if (!Number.isInteger(value.status) || typeof value.message !== 'string') return null;
  for (const field of ['code', 'type', 'param']) {
    if (value[field] !== null && typeof value[field] !== 'string') return null;
  }
  return error as OpenAiImageError;
}
