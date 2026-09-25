import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageFromPaste } from './photo.ts';

test('extracts an image file from a paste event without treating text as a photo', () => {
  const image = new File(['test image'], 'pasted.png', { type: 'image/png' });
  const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
  const clipboardData = {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'text/plain', getAsFile: () => text },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ],
    files: [],
  } as unknown as Pick<DataTransfer, 'items' | 'files'>;
  assert.equal(imageFromPaste(clipboardData), image);
  assert.equal(imageFromPaste({
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    files: [],
  } as unknown as Pick<DataTransfer, 'items' | 'files'>), null);
});

test('falls back to clipboard files when item data is unavailable', () => {
  const image = new File(['test image'], 'pasted.png', { type: 'image/png' });
  assert.equal(imageFromPaste({ items: [], files: [image] } as unknown as Pick<DataTransfer, 'items' | 'files'>), image);
});