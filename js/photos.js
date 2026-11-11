// Fotos: se reducen en el iPhone antes de guardarlas o enviarlas.
import * as db from './db.js';

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* algunos formatos no los decodifica: se prueba con <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function resize(source, max, quality) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve({ blob: b, width: canvas.width, height: canvas.height }) : reject(new Error('No se pudo procesar la foto'))), 'image/jpeg', quality));
}

/** Guarda una foto (1.200 px y miniatura de 300 px) y devuelve el registro. */
export async function savePhoto(file, purpose, plantId = null) {
  if (!file.type.startsWith('image/')) throw new Error('Ese archivo no es una imagen');
  const source = await decode(file);
  const [big, thumb] = await Promise.all([resize(source, 1200, 0.8), resize(source, 300, 0.75)]);
  source.close?.();
  return db.put('photos', {
    id: db.uid(), plantId, purpose, blob: big.blob, thumb: thumb.blob,
    width: big.width, height: big.height, takenAt: new Date().toISOString(),
  });
}

const urls = new Map();
/** URL para mostrar una miniatura; se reutiliza mientras la página esté abierta. */
export function photoURL(photo, size = 'thumb') {
  if (!photo) return null;
  const key = `${photo.id}:${size}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(size === 'thumb' ? photo.thumb : photo.blob));
  return urls.get(key);
}
