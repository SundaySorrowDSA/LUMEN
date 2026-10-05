import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadConversationPhotos, persistSentPhoto, photoDataUrlToBlob, photoMessageText, photoUrlForMessage,
  type LocalPhotoUrls,
} from './local-photos.ts';

test('imported attachments resolve original browser photos without moving or deleting them', async () => {
  const blob = new Blob(['fixture'], { type: 'image/jpeg' });
  const original = { conversationId: 19, messageId: 150, blob };
  const imported = await loadConversationPhotos(1, [{
    id: 200, metadata: JSON.stringify({ threadConsolidation: {
      sourceConversationId: 19, sourceMessageId: 150,
    } }),
  }], async (id) => id === 19 ? [original] : []);
  assert.deepEqual(imported, [{ conversationId: 1, messageId: 200, blob }]);
  assert.equal(original.conversationId, 19);
  assert.equal(original.messageId, 150);
});

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

test('a successful photo send attaches immediately to the returned user-message ID and saves under that key', async () => {
  const compressedPhoto = 'data:image/jpeg;base64,/9j/2Q==';
  const userMessage = {
    id: 812,
    conversationId: 24,
    role: 'user',
    content: '[Photo attached]\nWhat is this?',
  };
  let localPhotos: LocalPhotoUrls | null = null;
  const saved: Array<{ conversationId: number; messageId: number; photo: string }> = [];
  let finishWrite!: () => void;
  const writePending = new Promise<void>((resolve) => { finishWrite = resolve; });
  const write = persistSentPhoto(
    userMessage,
    compressedPhoto,
    (conversationId, messageId, url) => {
      localPhotos = { conversationId, urls: { [messageId]: url } };
    },
    async (conversationId, messageId, photo) => {
      saved.push({ conversationId, messageId, photo });
      await writePending;
    },
  );

  assert.equal(photoUrlForMessage(userMessage, localPhotos), compressedPhoto, 'thumbnail is visible before storage completes');
  assert.equal(photoUrlForMessage({ ...userMessage, id: 813 }, localPhotos), undefined, 'no photo appears on the reply');
  assert.equal(photoMessageText(userMessage.content, true), 'What is this?');
  assert.deepEqual(saved, [{ conversationId: 24, messageId: 812, photo: compressedPhoto }]);
  finishWrite();
  await write;
});