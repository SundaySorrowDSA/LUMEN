const MAX_ORIGINAL_BYTES = 25_000_000;
const MAX_UPLOAD_BYTES = 1_900_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Only use image files supplied by the user's paste event; never read the clipboard independently. */
export function imageFromPaste(clipboardData: Pick<DataTransfer, 'items' | 'files'>): File | null {
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return Array.from(clipboardData.files ?? []).find((file) => file.type.startsWith('image/')) ?? null;
}

/** Decode and downsize on-device. Upload only the compressed JPEG, never the original file. */
export async function resizePhoto(file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
    throw new Error('Choose a JPEG, PNG, WebP, or iPhone photo.');
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error('This photo is too large. Please choose one under 25 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This photo could not be opened. Try another image.'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('This photo could not be opened. Try another image.');
    }
    let maxEdge = 1600;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Photo processing is not available in this browser.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', attempt === 0 ? 0.8 : 0.68);
      if (dataUrl.startsWith('data:image/jpeg;base64,') &&
          Math.floor((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3 / 4) <= MAX_UPLOAD_BYTES) {
        return dataUrl;
      }
      maxEdge = Math.round(maxEdge * 0.75);
    }
    throw new Error('This photo could not be made small enough to send.');
  } finally {
    URL.revokeObjectURL(url);
  }
}