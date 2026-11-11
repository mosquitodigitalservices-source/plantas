// Copias de seguridad: todo en un .json (con las fotos en base64) que se guarda en Archivos / iCloud Drive.
import * as db from './db.js';

export const SCHEMA_VERSION = 1;
const USER_STORES = ['sites', 'plants', 'tasks', 'events', 'identifications', 'diagnoses', 'treatments', 'light_readings'];

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
/** Solo imágenes incrustadas en la copia: nunca se descarga nada de una dirección que venga en el archivo. */
const dataURLToBlob = async (url) => {
  if (typeof url !== 'string' || !/^data:image\/(jpeg|png|webp|heic);base64,/.test(url)) throw new Error('La copia tiene una foto que no es válida.');
  return (await fetch(url)).blob();
};

/** Crea el contenido de la copia. La clave de Pl@ntNet nunca se incluye. */
export async function buildBackup() {
  const stores = {};
  for (const s of USER_STORES) stores[s] = await db.all(s);
  stores.species = (await db.all('species')).filter((s) => s.origin === 'user');
  const { plantnetKey, plantnetRemaining, ...settings } = await db.getSettings();
  stores.settings = [settings];
  stores.photos = [];
  for (const p of await db.all('photos')) {
    const { blob, thumb, ...meta } = p;
    stores.photos.push({ ...meta, jpeg: await blobToDataURL(blob), thumbJpeg: await blobToDataURL(thumb) });
  }
  return { app: 'plantas', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), stores };
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Exporta: en el iPhone abre la hoja de Compartir (Guardar en Archivos); si no se puede, descarga el archivo. */
export async function exportBackup() {
  const data = await buildBackup();
  const file = new File([JSON.stringify(data)], `plantas-copia-${stamp()}.json`, { type: 'application/json' });
  let method = 'download';
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Copia de Plantas' });
      method = 'share';
    } catch (err) {
      if (err.name === 'AbortError') return { cancelled: true };
      method = 'download';
    }
  }
  if (method === 'download') {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  await db.saveSettings({ lastBackupAt: new Date().toISOString() });
  return { method, plants: data.stores.plants.filter((p) => !p.archivedAt).length, photos: data.stores.photos.length, bytes: file.size };
}

/** Lee y valida una copia. Devuelve un resumen para enseñar antes de importar. */
export async function readBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Ese archivo no es una copia de Plantas.');
  }
  if (data?.app !== 'plantas' || typeof data.schemaVersion !== 'number' || !data.stores) throw new Error('Ese archivo no es una copia de Plantas.');
  if (data.schemaVersion > SCHEMA_VERSION) throw new Error('La copia es de una versión más nueva de la app. Actualiza la app y vuelve a probar.');
  for (const s of [...USER_STORES, 'photos', 'species']) {
    if (data.stores[s] != null && !Array.isArray(data.stores[s])) throw new Error('La copia está dañada.');
  }
  return {
    data,
    summary: {
      exportedAt: data.exportedAt,
      plants: (data.stores.plants || []).filter((p) => !p.archivedAt).length,
      photos: (data.stores.photos || []).length,
      events: (data.stores.events || []).length,
    },
  };
}

/** Sustituye todos los datos por los de la copia, en una sola transacción. Mantiene la clave de Pl@ntNet actual. */
export async function importBackup(data) {
  const photos = [];
  for (const p of data.stores.photos || []) {
    const { jpeg, thumbJpeg, ...meta } = p;
    photos.push({ ...meta, blob: await dataURLToBlob(jpeg), thumb: await dataURLToBlob(thumbJpeg || jpeg) });
  }
  const current = await db.getSettings();
  const imported = data.stores.settings?.[0] || {};
  await db.tx([...USER_STORES, 'photos', 'species', 'settings'], 'readwrite', ({ store }) => {
    for (const s of [...USER_STORES, 'photos']) store(s).clear();
    for (const s of USER_STORES) for (const row of data.stores[s] || []) store(s).put(row);
    for (const p of photos) store('photos').put(p);
    for (const sp of data.stores.species || []) store('species').put(db.normaliseSpecies({ ...sp, origin: 'user' }));
    store('settings').put({
      ...current, ...imported, key: 'app',
      plantnetKey: current.plantnetKey, plantnetRemaining: current.plantnetRemaining,
      catalogVersion: current.catalogVersion, lastBackupAt: data.exportedAt || current.lastBackupAt,
    });
  });
}

/** Borra todos los datos del usuario (no el catálogo ni la clave). */
export async function wipeAll() {
  const current = await db.getSettings();
  await db.tx([...USER_STORES, 'photos', 'species', 'settings'], 'readwrite', async ({ store, req }) => {
    for (const s of [...USER_STORES, 'photos']) store(s).clear();
    const user = (await req(store('species').getAll())).filter((s) => s.origin === 'user');
    for (const s of user) store('species').delete(s.id);
    store('settings').put({ key: 'app', plantnetKey: current.plantnetKey, catalogVersion: current.catalogVersion, hemisphere: current.hemisphere, digestTime: current.digestTime });
  });
}

export function backupAge(settings) {
  if (!settings.lastBackupAt) return null;
  return Math.floor((Date.now() - new Date(settings.lastBackupAt)) / 86400000);
}
