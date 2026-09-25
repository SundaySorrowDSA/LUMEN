import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageFromPaste, imageFromPasteDetails, photoReadyForSend } from './photo.ts';

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
  assert.deepEqual(imageFromPasteDetails(clipboardData), { file: image, representation: 'items' });
  assert.equal(imageFromPaste({
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    files: [],
  } as unknown as Pick<DataTransfer, 'items' | 'files'>), null);
});

test('falls back to clipboard files when item data is unavailable', () => {
  const image = new File(['test image'], 'pasted.png', { type: 'image/png' });
  assert.equal(imageFromPaste({ items: [], files: [image] } as unknown as Pick<DataTransfer, 'items' | 'files'>), image);
  assert.deepEqual(imageFromPasteDetails({ items: [], files: [image] } as unknown as Pick<DataTransfer, 'items' | 'files'>), {
    file: image, representation: 'files',
  });
});

test('iOS-like items with empty files work even when the item MIME declaration is blank', () => {
  const image = new File(['pixels'], 'clipboard.png', { type: 'image/png' });
  const clipboard = {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: '', getAsFile: () => image },
    ],
    files: [],
  } as unknown as Pick<DataTransfer, 'items' | 'files'>;
  assert.deepEqual(imageFromPasteDetails(clipboard), { file: image, representation: 'items' });
});

test('an item MIME type normalizes a typeless image File, without reading unrelated text', () => {
  const image = new File(['pixels'], '', { type: '' });
  const clipboard = {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ],
    files: [],
  } as unknown as Pick<DataTransfer, 'items' | 'files'>;
  const result = imageFromPasteDetails(clipboard);
  assert.equal(result?.representation, 'items');
  assert.equal(result?.file.type, 'image/png');
  assert.equal(result?.file.size, image.size);
  assert.equal(imageFromPaste({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } as unknown as Pick<DataTransfer, 'items' | 'files'>), null);
});

test('uses a supported PNG when the pasteboard also advertises an unsupported TIFF', () => {
  const png = new File(['png'], 'converted.png', { type: 'image/png' });
  const tiff = new File(['tiff'], 'original.tiff', { type: 'image/tiff' });
  const clipboard = {
    items: [
      { kind: 'file', type: 'image/tiff', getAsFile: () => tiff },
      { kind: 'file', type: '', getAsFile: () => png },
    ],
    files: [],
  } as unknown as Pick<DataTransfer, 'items' | 'files'>;
  assert.deepEqual(imageFromPasteDetails(clipboard), { file: png, representation: 'items' });
});

test('send waits for asynchronous conversion and rejects an older prepared image', async () => {
  let finishConversion!: (value: string) => void;
  const conversion = new Promise<string>((resolve) => { finishConversion = resolve; });
  let prepared: string | null = null;
  let photo: string | null = 'old-photo';
  let processing = true;
  assert.equal(photoReadyForSend(photo, prepared, processing), false);
  const pending = conversion.then((jpeg) => {
    prepared = jpeg;
    photo = jpeg;
    processing = false;
  });
  finishConversion('data:image/jpeg;base64,compressed');
  await pending;
  assert.equal(photoReadyForSend(photo, prepared, processing), true);
  assert.equal(photoReadyForSend('old-photo', prepared, processing), false);
});

test('picker and paste share the same prepared-JPEG send gate', () => {
  const jpeg = 'data:image/jpeg;base64,compressed';
  for (const source of ['picker', 'paste'] as const) {
    assert.equal(photoReadyForSend(jpeg, jpeg, false), true, source);
    assert.equal(photoReadyForSend(jpeg, jpeg, true), false, source);
  }
});