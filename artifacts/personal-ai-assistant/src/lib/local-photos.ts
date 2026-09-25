import { deletePhotoDiagnostics } from './photo-diagnostics.ts';

const DATABASE_NAME = 'lumen-local-photos';
const STORE_NAME = 'photos';
const DATABASE_VERSION = 1;

type StoredPhoto = {
  conversationId: number;
  messageId: number;
  blob: Blob;
};

export type LocalPhotoUrls = {
  conversationId: number;
  urls: Record<number, string>;
};

type PhotoMessage = {
  id: number;
  conversationId: number;
  role: string;
  content: string;
};

export function photoUrlForMessage(message: PhotoMessage, photos: LocalPhotoUrls | null): string | undefined {
  if (message.role !== 'user' || !message.content.startsWith('[Photo attached]')) return undefined;
  if (photos?.conversationId !== Number(message.conversationId)) return undefined;
  return photos.urls[Number(message.id)];
}

/** Show the returned user's photo immediately; persist the same bytes under the returned IDs. */
export function persistSentPhoto(
  message: PhotoMessage,
  dataUrl: string,
  showImmediately: (conversationId: number, messageId: number, url: string) => void,
  persist: (conversationId: number, messageId: number, url: string) => Promise<void> = saveLocalPhoto,
): Promise<void> {
  const conversationId = Number(message.conversationId);
  const messageId = Number(message.id);
  if (message.role !== 'user' || !message.content.startsWith('[Photo attached]') ||
      !Number.isSafeInteger(conversationId) || !Number.isSafeInteger(messageId)) {
    return Promise.reject(new Error('The returned photo message could not be identified.'));
  }
  showImmediately(conversationId, messageId, dataUrl);
  return persist(conversationId, messageId, dataUrl);
}

export function photoDataUrlToBlob(dataUrl: string): Blob {
  const prefix = 'data:image/jpeg;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Unsupported local photo format.');
  const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Local photo storage is unavailable.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: ['conversationId', 'messageId'] });
      store.createIndex('conversationId', 'conversationId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local photo storage could not be opened.'));
    request.onblocked = () => reject(new Error('Local photo storage is blocked by another tab.'));
  });
}

function transactionDone(transaction: IDBTransaction, database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Local photo storage was interrupted.'));
    };
    transaction.onerror = () => {
      // The abort event reports the final transaction outcome.
    };
  });
}

export async function saveLocalPhoto(conversationId: number, messageId: number, dataUrl: string): Promise<void> {
  const blob = photoDataUrlToBlob(dataUrl);
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction, database);
  transaction.objectStore(STORE_NAME).put({ conversationId, messageId, blob } satisfies StoredPhoto);
  await done;
}

export async function loadLocalPhotos(conversationId: number): Promise<StoredPhoto[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(transaction, database);
  const request = transaction.objectStore(STORE_NAME).index('conversationId').getAll(conversationId);
  const result = new Promise<StoredPhoto[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as StoredPhoto[]);
    request.onerror = () => reject(request.error ?? new Error('Local photos could not be read.'));
  });
  const [photos] = await Promise.all([result, done]);
  return photos;
}

export async function deleteLocalPhotos(conversationId: number): Promise<void> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction, database);
    const request = transaction.objectStore(STORE_NAME).index('conversationId').openCursor(conversationId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    await done;
  } finally {
    deletePhotoDiagnostics(conversationId);
  }
}

export function photoMessageText(content: string, hasLocalPhoto: boolean): string {
  return hasLocalPhoto && content.startsWith('[Photo attached]')
    ? content.slice('[Photo attached]'.length).replace(/^\n/, '')
    : content;
}