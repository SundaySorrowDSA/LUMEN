import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoDataUrlToBlob, photoMessageText } from './local-photos.ts';

test('local copy retains the compressed JPEG bytes instead of the original file', async () => {
  const bytes = [0xff, 0xd8, 0xff, 0xd9];
  const photo = photoDataUrlToBlob(`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`);
  assert.equal(photo.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await photo.arrayBuffer())], bytes);
});

test('the marker remains visible without a local photo', () => {
  assert.equal(photoMessageText('[Photo attached]\nWhat is this?', false), '[Photo attached]\nWhat is this?');
  assert.equal(photoMessageText('[Photo attached]\nWhat is this?', true), 'What is this?');
  assert.equal(photoMessageText('[Photo attached]', true), '');
  assert.equal(photoMessageText('ordinary message', true), 'ordinary message');
});