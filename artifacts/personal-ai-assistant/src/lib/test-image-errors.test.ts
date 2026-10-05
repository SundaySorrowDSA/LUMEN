import assert from 'node:assert/strict';
import test from 'node:test';
import { readTestImageError } from './test-image-errors.ts';

test('reads OpenAI message, status, code, type and param from a test endpoint error', () => {
  const details = {
    status: 400,
    message: 'The image prompt was rejected.',
    code: 'invalid_image_prompt',
    type: 'invalid_request_error',
    param: 'prompt',
  };
  assert.deepEqual(readTestImageError({ data: { error: 'Image generation failed', openaiError: details } }), details);
  const nullableDetails = { ...details, code: null, param: null };
  assert.deepEqual(readTestImageError({ data: { openaiError: nullableDetails } }), nullableDetails);
});

test('ordinary, production and malformed errors do not display development detail fields', () => {
  for (const failure of [
    undefined, new Error('Network failure'), { data: { error: 'Image generation failed' } },
    { data: { openaiError: null } }, { data: { openaiError: 'Invalid response' } },
    { data: { openaiError: { status: '400', message: 'Bad prompt' } } },
    { data: { openaiError: { status: 400, message: 'Bad prompt', code: {}, type: null, param: null } } },
  ]) {
    assert.equal(readTestImageError(failure), null);
  }
});
