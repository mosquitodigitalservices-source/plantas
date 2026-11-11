// La app se mudó de GitHub Pages (origen compartido con otros proyectos) a Firebase Hosting (origen propio).
// En la dirección antigua se avisa y se ofrece borrar los datos de aquí cuando ya estés en la nueva.
export const NEW_URL = 'https://plantas-d89b6.web.app/';
export const isOldAddress = () => location.hostname.endsWith('github.io');

/** Borra todo lo que la app guardó en esta dirección: sesión, datos, caché y service worker. */
export async function wipeThisAddress() {
  try { await (await import('./sync.js')).signOut(); } catch { /* sin sesión */ }
  const names = (await indexedDB.databases?.().catch(() => [])) || [];
  const all = new Set(['plantas', 'firebaseLocalStorageDb', ...names.map((d) => d.name).filter(Boolean)]);
  await Promise.all([...all].map((name) => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  })));
  for (const key of (await caches?.keys?.()) || []) await caches.delete(key);
  for (const reg of (await navigator.serviceWorker?.getRegistrations?.()) || []) await reg.unregister();
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* nada */ }
}
