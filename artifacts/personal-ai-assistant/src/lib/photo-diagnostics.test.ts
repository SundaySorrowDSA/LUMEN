import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deletePhotoDiagnostics, readPhotoDiagnostics, updatePhotoDiagnostic,
} from './photo-diagnostics.ts';

test('back-to-back sends keep separate metadata under their returned IDs across reloads', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  updatePhotoDiagnostic(24, 812, { source: 'paste', pasteRepresentation: 'items', compressedAtSend: true, save: 'pending', sentAt: 100 }, storage);
  updatePhotoDiagnostic(24, 814, { source: 'picker', compressedAtSend: true, save: 'pending', sentAt: 200 }, storage);
  updatePhotoDiagnostic(24, 812, { save: 'saved' }, storage);
  updatePhotoDiagnostic(24, 814, { save: 'failed' }, storage);

  assert.deepEqual(readPhotoDiagnostics(24, storage), {
    812: { source: 'paste', pasteRepresentation: 'items', compressedAtSend: true, save: 'saved', sentAt: 100 },
    814: { source: 'picker', compressedAtSend: true, save: 'failed', sentAt: 200 },
  });
  assert.deepEqual(readPhotoDiagnostics(25, storage), {});
  assert.ok([...values.values()].every((value) => !value.includes('data:image/') && !value.includes('blob:')));

  updatePhotoDiagnostic(24, 814, { dismissed: true }, storage);
  assert.equal(readPhotoDiagnostics(24, storage)[814].dismissed, true);
  deletePhotoDiagnostics(24, storage);
  assert.deepEqual(readPhotoDiagnostics(24, storage), {});
});

test('stored diagnostic data is limited to metadata fields', () => {
  const storage = {
    getItem: () => JSON.stringify({
      812: { source: 'paste', save: 'saved', imageUrl: 'data:image/jpeg;base64,private' },
    }),
    setItem: (_key: string, value: string) => {
      assert.equal(value.includes('private'), false);
      assert.equal(value.includes('imageUrl'), false);
    },
    removeItem: () => {},
  };
  assert.deepEqual(readPhotoDiagnostics(24, storage)[812], { source: 'paste', save: 'saved' });
  updatePhotoDiagnostic(24, 812, { dismissed: true }, storage);
});