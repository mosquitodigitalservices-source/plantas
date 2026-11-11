// Estado de la sesión, sin dependencias: lo rellena js/sync.js y lo leen los módulos que lo necesitan.
export const session = {
  /** { uid, email, name, verified } o null */
  user: null,
  /** { id, name, memberUids, memberNames, ownerUid } o null */
  household: null,
  /** Lo instala sync.js cuando hay casa: (taskId, eventId, patch, event) => { already, event } */
  remoteComplete: null,
  /** { householdId, localPlants }: la cuenta tiene casa y este dispositivo tiene plantas propias */
  pendingMerge: null,
  /** 'off' (sin cuenta), 'local' (cuenta sin casa), 'syncing', 'synced', 'error' */
  state: 'off',
  error: null,
};

const listeners = new Set();
export const onSession = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emitSession() {
  for (const fn of listeners) { try { fn(session); } catch (err) { console.error(err); } }
}

/** Nombre corto para "Hecho por …": tú o el nombre del otro miembro. */
export function whoText(uid, name) {
  if (!uid) return null;
  if (session.user && uid === session.user.uid) return 'ti';
  // Primero el nombre de la lista de miembros: el que viene en cada registro lo puede poner cualquiera.
  return session.household?.memberNames?.[uid] || name || 'otra persona';
}
