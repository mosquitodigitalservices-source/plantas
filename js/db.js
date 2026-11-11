// Capa de datos: IndexedDB "plantas" (ver replica/schema.md). Sin dependencias.

const DB_NAME = 'plantas';
const DB_VERSION = 1;

const STORES = {
  settings: { keyPath: 'key' },
  species: { keyPath: 'id', indexes: [['scientificName'], ['genus'], ['commonNamesFlat', { multiEntry: true }]] },
  problems: { keyPath: 'id' },
  sites: { keyPath: 'id' },
  plants: { keyPath: 'id', indexes: [['siteId'], ['speciesId'], ['archivedAt']] },
  photos: { keyPath: 'id', indexes: [['plantId'], ['plantId_takenAt', { keyPath: ['plantId', 'takenAt'] }]] },
  tasks: { keyPath: 'id', indexes: [['plantId'], ['nextDueOn'], ['plantTypeLabel', { keyPath: 'uniqueKey', unique: true }]] },
  events: { keyPath: 'id', indexes: [['plantId_happenedAt', { keyPath: ['plantId', 'happenedAt'] }], ['taskDay', { keyPath: ['taskId', 'onDate'], unique: true }]] },
  identifications: { keyPath: 'id', indexes: [['status']] },
  diagnoses: { keyPath: 'id', indexes: [['plantId']] },
  treatments: { keyPath: 'id', indexes: [['plantId']] },
  light_readings: { keyPath: 'id', indexes: [['plantId'], ['siteId']] },
};

let dbPromise;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [index, opts = {}] of def.indexes || []) {
          store.createIndex(index, opts.keyPath || index, { unique: !!opts.unique, multiEntry: !!opts.multiEntry });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está abierta en otra pestaña. Ciérrala y vuelve a intentarlo.'));
  });
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// ------------------------------------------------------------- cambios (para la sincronización)
/** Almacenes que se comparten con la casa cuando hay cuenta (ver js/sync.js). */
export const SHARED_STORES = ['plants', 'sites', 'tasks', 'events', 'treatments', 'species', 'light_readings', 'diagnoses'];
const writeListeners = new Set();
/** fn([{ store, op: 'put' | 'delete', value?, key? }]) tras cada transacción que cambie almacenes compartidos. */
export const onLocalWrite = (fn) => { writeListeners.add(fn); return () => writeListeners.delete(fn); };

/** Envuelve un almacén para anotar put/delete (clear no se anota: nunca se propaga a la casa). */
function recording(store, name, log) {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'put') return (value, key) => { log.push({ store: name, op: 'put', value }); return target.put(value, key); };
      if (prop === 'delete') return (key) => { log.push({ store: name, op: 'delete', key }); return target.delete(key); };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/**
 * Ejecuta fn dentro de una transacción. fn recibe { store(name) } y puede ser async solo con peticiones de IDB.
 * opts.remote = true: el cambio viene de la casa (no se vuelve a subir).
 */
export async function tx(names, mode, fn, opts = {}) {
  const db = await open();
  const t = db.transaction(names, mode);
  const finished = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
  });
  const log = [];
  const track = mode === 'readwrite' && !opts.remote && writeListeners.size;
  const store = (n) => (track && SHARED_STORES.includes(n) ? recording(t.objectStore(n), n, log) : t.objectStore(n));
  const result = await fn({ store, req: done, abort: () => t.abort() });
  await finished;
  if (log.length) for (const l of writeListeners) { try { l(log); } catch (err) { console.error(err); } }
  return result;
}

export const get = (store, key) => tx([store], 'readonly', ({ store: s }) => done(s(store).get(key)));
export const all = (store) => tx([store], 'readonly', ({ store: s }) => done(s(store).getAll()));
export const byIndex = (store, index, query) =>
  tx([store], 'readonly', ({ store: s }) => done(s(store).index(index).getAll(query)));
export const del = (store, key) => tx([store], 'readwrite', ({ store: s }) => done(s(store).delete(key)));

export function put(store, value, opts) {
  const now = new Date().toISOString();
  const record = { createdAt: now, ...value, updatedAt: now };
  return tx([store], 'readwrite', ({ store: s }) => done(s(store).put(record)), opts).then(() => record);
}

export const uid = () => crypto.randomUUID();

// ------------------------------------------------------------- ajustes
const DEFAULT_SETTINGS = {
  key: 'app',
  plantnetKey: null,
  plantnetRemaining: null,
  hemisphere: 'north',
  digestTime: '09:00',
  luxCalibration: 1,
  lastBackupAt: null,
  calendarExportedAt: null,
  calendarHash: null,
  calendarUntil: null,
  catalogVersion: 0,
  locale: 'es',
};

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await get('settings', 'app')) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  return put('settings', { ...current, ...patch, key: 'app' });
}

// ------------------------------------------------------------- catálogo
let catalogCache;

/** Carga data/species.json y lo guarda en IndexedDB si la versión es nueva. Devuelve las plantillas por tipo. */
export async function loadCatalog() {
  if (catalogCache) return catalogCache;
  const res = await fetch(new URL('../data/species.json', import.meta.url));
  if (!res.ok) throw new Error('No se pudo cargar el catálogo de plantas');
  const catalog = await res.json();
  const settings = await getSettings();
  if (settings.catalogVersion !== catalog.version) {
    await tx(['species'], 'readwrite', ({ store }) => {
      for (const sp of catalog.species) store('species').put(normaliseSpecies({ ...sp, origin: 'catalog' }));
    });
    await saveSettings({ catalogVersion: catalog.version });
  }
  catalogCache = catalog;
  return catalog;
}

export function normaliseSpecies(sp) {
  const names = [...(sp.commonNames?.es || []), ...(sp.commonNames?.en || []), sp.scientificName];
  return {
    care: {},
    notes: '',
    toxicPets: null,
    ...sp,
    commonNamesFlat: [...new Set(names.filter(Boolean).map((n) => n.toLowerCase()))],
  };
}

/** Cuidados efectivos: plantilla del tipo < especie < ajustes de la planta. */
export function resolveCare(kinds, species, plant) {
  const kind = plant?.kind || species?.kind || 'other';
  return { ...kinds[kind], ...(species?.care || {}), ...(plant?.careOverride || {}) };
}

export function displayName(species) {
  return species?.commonNames?.es?.[0] || species?.scientificName || 'Planta sin identificar';
}
