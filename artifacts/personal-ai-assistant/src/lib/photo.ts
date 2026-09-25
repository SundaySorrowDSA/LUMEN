const MAX_ORIGINAL_BYTES = 25_000_000;
const MAX_UPLOAD_BYTES = 1_900_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Only use image files supplied by the user's paste event; never read the clipboard independently. */
export function imageFromPasteDetails(clipboardData: Pick<DataTransfer, 'items' | 'files'>): {
  file: File;
  representation: 'items' | 'files';
} | null {
  let unsupportedImage: { file: File; representation: 'items' | 'files' } | null = null;
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== 'file') continue;
    let file: File | null;
    try {
      file = item.getAsFile();
    } catch {
      continue;
    }
    if (!file) continue;
    const fileType = file.type.toLowerCase();
    const itemType = item.type.toLowerCase();
    const imageType = fileType.startsWith('image/') ? fileType : itemType;
    if (!imageType.startsWith('image/')) continue;
    const candidate = {
      // Safari can expose an image item whose File has no MIME type. Give the
      // common compressor a typed File without changing the image bytes.
      file: fileType === imageType ? file : new File([file], file.name || 'pasted-image', { type: imageType }),
      representation: 'items' as const,
    };
    if (ALLOWED_TYPES.has(imageType)) return candidate;
    unsupportedImage ??= candidate;
  }
  const files = Array.from(clipboardData.files ?? []);
  const file = files.find((candidate) => ALLOWED_TYPES.has(candidate.type.toLowerCase()));
  if (file) return { file, representation: 'files' };
  const otherImage = files.find((candidate) => candidate.type.toLowerCase().startsWith('image/'));
  return unsupportedImage ?? (otherImage ? { file: otherImage, representation: 'files' } : null);
}

export function imageFromPaste(clipboardData: Pick<DataTransfer, 'items' | 'files'>): File | null {
  return imageFromPasteDetails(clipboardData)?.file ?? null;
}

/** A pending conversion must not send an older photo from the previous render. */
export function photoReadyForSend(photo: string | null, prepared: string | null, processing: boolean): boolean {
  return !processing && photo === prepared;
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