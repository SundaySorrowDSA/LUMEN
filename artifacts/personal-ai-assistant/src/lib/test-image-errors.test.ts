import assert from 'node:assert/strict';
import test from 'node:test';
import { readConversationImageFailure, readTestImageError } from './test-image-errors.ts';

test('conversation image failures stay clear without development-only diagnostics', () => {
  for (const error of [
    'Image generation or saving the result failed. Nothing was added to this conversation.',
    'OpenAI image generation failed (HTTP 400).',
    'Ren is unavailable. The image request was not saved.',
  ]) assert.equal(readConversationImageFailure({ data: { error, tool: 'generate_image' } }), error);
  assert.equal(readConversationImageFailure({ data: { error: 'Ordinary chat failure' } }), null);
  assert.equal(readConversationImageFailure(null), null);
});

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
