// Cuentas (Firebase Auth) y casa compartida (Firestore), espejo de los almacenes compartidos de IndexedDB.
//
// - IndexedDB sigue siendo la fuente de las pantallas. Con casa, cada cambio local de un almacén
//   compartido se sube a households/{hid}/{almacén}/{id}, y cada cambio remoto se escribe en IndexedDB
//   (marcado como remoto para no volver a subirlo). Al llegar cambios remotos se lanza el evento
//   "plantas:remote-change" para repintar.
// - Firestore guarda su propia caché en el dispositivo: sin conexión todo sigue funcionando y se sube luego.
// - El SDK se carga desde el CDN de Google con versión fija; si no carga (sin red la primera vez),
//   la app sigue en modo local.
import * as db from './db.js';
import { firebaseConfig } from './firebase-config.js';
import { session, emitSession } from './session.js';

const V = '13.1.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;
let fb; // { app, auth, fs, A: módulo auth, F: módulo firestore }
let unsubs = [];
let pushQueue = Promise.resolve();

async function load() {
  if (fb) return fb;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  auth.languageCode = 'es';
  const fs = F.initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  fb = { app, auth, fs, A, F };
  return fb;
}

const hhRef = (hid) => fb.F.doc(fb.fs, 'households', hid);
const itemRef = (hid, store, id) => fb.F.doc(fb.fs, 'households', hid, store, id);
const userRef = (uid) => fb.F.doc(fb.fs, 'users', uid);

const AUTH_ERRORS = {
  'auth/invalid-email': 'Ese correo no parece válido.',
  'auth/missing-password': 'Escribe la contraseña.',
  'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
  'auth/email-already-in-use': 'Ya hay una cuenta con ese correo. Prueba a entrar.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Contraseña incorrecta.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/network-request-failed': 'Sin conexión. Inténtalo cuando tengas internet.',
  'auth/requires-recent-login': 'Por seguridad, vuelve a escribir tu contraseña.',
  'permission-denied': 'No tienes permiso para hacer eso.',
  unavailable: 'Sin conexión con el servidor. Inténtalo cuando tengas internet.',
};
export function friendly(err) {
  return new Error(AUTH_ERRORS[err?.code] || err?.message || 'Algo ha fallado.');
}

// ------------------------------------------------------------- arranque
export async function start() {
  try {
    await load();
  } catch {
    session.state = 'off';
    session.error = 'No se pudo cargar el sistema de cuentas (¿sin conexión?). La app funciona igual en este dispositivo.';
    emitSession();
    return;
  }
  db.onLocalWrite((log) => { pushQueue = pushQueue.then(() => push(log)).catch((e) => console.error('subida', e)); });
  fb.A.onAuthStateChanged(fb.auth, async (user) => {
    stopListening();
    if (!user) {
      Object.assign(session, { user: null, household: null, remoteComplete: null, pendingMerge: null, state: 'off', error: null });
      emitSession();
      return;
    }
    session.user = { uid: user.uid, email: user.email, name: user.displayName || user.email.split('@')[0], verified: user.emailVerified };
    session.state = 'local';
    emitSession();
    try {
      const snap = await fb.F.getDoc(userRef(user.uid));
      if (!snap.exists()) {
        await fb.F.setDoc(userRef(user.uid), { displayName: session.user.name, email: user.email, createdAt: fb.F.serverTimestamp() }, { merge: true });
      }
      if (!snap.exists() || !snap.data().householdId) {
        // Toda cuenta tiene una casa: así sus plantas se guardan solas en la nube aunque no comparta.
        await ensureHousehold();
      } else {
        const hid = snap.data().householdId;
        const settings = await db.getSettings();
        const localPlants = (await db.all('plants')).length;
        if (settings.linkedHouseholdId !== hid && localPlants) {
          // Este dispositivo tiene plantas propias: se pregunta antes de mezclarlas o borrarlas.
          session.pendingMerge = { householdId: hid, localPlants };
          emitSession();
        } else {
          await listen(hid);
        }
      }
    } catch (err) {
      session.error = friendly(err).message;
      emitSession();
    }
  });
}

// ------------------------------------------------------------- cuenta
export async function signUp(name, email, password) {
  await load();
  try {
    const cred = await fb.A.createUserWithEmailAndPassword(fb.auth, email, password);
    await fb.A.updateProfile(cred.user, { displayName: name });
    await fb.F.setDoc(userRef(cred.user.uid), { displayName: name, email, createdAt: fb.F.serverTimestamp() }, { merge: true });
    session.user = { ...session.user, name };
    await creating?.catch(() => {}); // si la casa automática se está creando, se espera para corregirle el nombre
    if (session.household?.memberNames) {
      // La casa automática pudo crearse con el nombre provisional (el del correo).
      fb.F.updateDoc(hhRef(session.household.id), { name: personalName(), [`memberNames.${cred.user.uid}`]: name }).catch(() => {});
    }
    emitSession();
    fb.A.sendEmailVerification(cred.user).catch(() => {});
  } catch (err) { throw friendly(err); }
}

export async function signIn(email, password) {
  await load();
  try { await fb.A.signInWithEmailAndPassword(fb.auth, email, password); } catch (err) { throw friendly(err); }
}

export async function resetPassword(email) {
  await load();
  try { await fb.A.sendPasswordResetEmail(fb.auth, email); } catch (err) { throw friendly(err); }
}

export async function resendVerification() {
  try { await fb.A.sendEmailVerification(fb.auth.currentUser); } catch (err) { throw friendly(err); }
}

export async function signOut() {
  stopListening();
  await fb.A.signOut(fb.auth);
}

/** Borra la cuenta: sale de la casa, borra users/{uid} y el usuario. Pide la contraseña otra vez. */
export async function deleteAccount(password) {
  const user = fb.auth.currentUser;
  try {
    await fb.A.reauthenticateWithCredential(user, fb.A.EmailAuthProvider.credential(user.email, password));
    if (session.household) await leaveHousehold({ recreate: false });
    await fb.F.deleteDoc(userRef(user.uid));
    await fb.A.deleteUser(user);
  } catch (err) { throw friendly(err); }
}

// ------------------------------------------------------------- casa
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

const personalName = () => `Casa de ${session.user.name}`;
let creating = null;

/** Si la cuenta no tiene casa, crea una propia (una sola vez aunque se llame varias). */
export function ensureHousehold() {
  if (session.household || session.pendingMerge) return Promise.resolve();
  creating ||= createHousehold(personalName()).finally(() => { creating = null; });
  return creating;
}

/** Crea una casa con el usuario como único miembro y sube los datos locales. */
export async function createHousehold(name) {
  const { uid, name: me } = session.user;
  try {
    const ref = await fb.F.addDoc(fb.F.collection(fb.fs, 'households'), {
      name, ownerUid: uid, memberUids: [uid], memberNames: { [uid]: me }, createdAt: fb.F.serverTimestamp(),
    });
    await fb.F.setDoc(userRef(uid), { householdId: ref.id, updatedAt: fb.F.serverTimestamp() }, { merge: true });
    await uploadAll(ref.id);
    await listen(ref.id);
    return ref.id;
  } catch (err) { throw friendly(err); }
}

/** Código de invitación de 6 caracteres que caduca en 48 horas. */
export async function createInvite() {
  const code = newCode();
  try {
    await fb.F.setDoc(fb.F.doc(fb.fs, 'invites', code), {
      householdId: session.household.id, createdBy: session.user.uid,
      expiresAt: fb.F.Timestamp.fromMillis(Date.now() + 48 * 3600 * 1000),
    });
    return code;
  } catch (err) { throw friendly(err); }
}

/** Comprueba un código antes de unirse. Devuelve { householdId } o lanza un error claro. */
export async function checkInvite(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('El código tiene 6 letras y números.');
  let snap;
  try { snap = await fb.F.getDoc(fb.F.doc(fb.fs, 'invites', code)); } catch (err) { throw friendly(err); }
  if (!snap.exists()) throw new Error('Ese código no existe. Revísalo o pide uno nuevo.');
  if (snap.data().expiresAt.toMillis() < Date.now()) throw new Error('Ese código ha caducado. Pide uno nuevo.');
  return { code, householdId: snap.data().householdId };
}

/**
 * Se une a la casa del código. withLocal: true sube las plantas de este dispositivo a la casa;
 * false las borra de este dispositivo (la pantalla ofrece hacer una copia antes).
 */
export async function joinHousehold(code, withLocal) {
  const { householdId } = await checkInvite(code);
  const { uid, name } = session.user;
  const oldHid = session.household?.id;
  if (oldHid === householdId) throw new Error('Ya estás en esa casa.');
  stopListening();
  try {
    const batch = fb.F.writeBatch(fb.fs);
    batch.set(fb.F.doc(fb.fs, 'households', householdId, 'joins', uid), { code: code.trim().toUpperCase(), at: fb.F.serverTimestamp() });
    batch.update(hhRef(householdId), { memberUids: fb.F.arrayUnion(uid), [`memberNames.${uid}`]: name });
    batch.delete(fb.F.doc(fb.fs, 'invites', code.trim().toUpperCase())); // un solo uso
    await batch.commit();
    await fb.F.setDoc(userRef(uid), { householdId, updatedAt: fb.F.serverTimestamp() }, { merge: true });
    if (withLocal) await uploadAll(householdId);
    else await clearLocalShared();
    // La casa anterior se deja (y se borra de la nube si no queda nadie): sus plantas ya están aquí si se juntaron.
    if (oldHid) await removeFromHouse(oldHid, uid).catch((e) => console.error('salir de la casa anterior', e));
    await listen(householdId);
  } catch (err) {
    if (oldHid && !session.household) listen(oldHid).catch(() => {});
    throw friendly(err);
  }
}

/** Saca al usuario de una casa; si era el último miembro, borra la casa y sus datos de la nube. */
async function removeFromHouse(hid, uid) {
  const snap = await fb.F.getDoc(hhRef(hid));
  if (!snap.exists()) return;
  if (snap.data().memberUids.length <= 1) {
    for (const store of db.SHARED_STORES) {
      const docs = await fb.F.getDocs(fb.F.collection(fb.fs, 'households', hid, store));
      for (let i = 0; i < docs.docs.length; i += 400) {
        const b = fb.F.writeBatch(fb.fs);
        docs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    }
    await fb.F.deleteDoc(hhRef(hid));
  } else {
    const d = snap.data();
    const b = fb.F.writeBatch(fb.fs);
    b.delete(fb.F.doc(fb.fs, 'households', hid, 'joins', uid)); // para poder volver a entrar más adelante
    const patch = { memberUids: fb.F.arrayRemove(uid), [`memberNames.${uid}`]: fb.F.deleteField() };
    if (d.ownerUid === uid) patch.ownerUid = d.memberUids.find((m) => m !== uid); // la casa pasa a otro miembro
    b.update(hhRef(hid), patch);
    await b.commit();
  }
}

/** Quien creó la casa expulsa a otro miembro. */
export async function removeMember(memberUid) {
  const hid = session.household.id;
  if (session.household.ownerUid !== session.user.uid) throw new Error('Solo quien creó la casa puede sacar a alguien.');
  if (memberUid === session.user.uid) throw new Error('Para irte tú, usa "Salir de la casa".');
  try {
    const b = fb.F.writeBatch(fb.fs);
    b.update(hhRef(hid), { memberUids: fb.F.arrayRemove(memberUid), [`memberNames.${memberUid}`]: fb.F.deleteField() });
    b.delete(fb.F.doc(fb.fs, 'households', hid, 'joins', memberUid));
    await b.commit();
  } catch (err) { throw friendly(err); }
}

/** Anula un código de invitación que aún no se ha usado. */
export async function revokeInvite(code) {
  try { await fb.F.deleteDoc(fb.F.doc(fb.fs, 'invites', code)); } catch (err) { throw friendly(err); }
}

/** Ya no somos miembros (nos han sacado, la casa se borró o salimos desde otro dispositivo). */
async function lostHousehold() {
  stopListening();
  Object.assign(session, { household: null, remoteComplete: null, state: 'local' });
  emitSession();
  remoteChanged();
  try {
    await db.saveSettings({ linkedHouseholdId: null });
    await fb.F.setDoc(userRef(session.user.uid), { householdId: null, updatedAt: fb.F.serverTimestamp() }, { merge: true });
    // Las plantas siguen en este dispositivo: pasan a una casa propia nueva para no perderlas.
    await ensureHousehold();
  } catch (err) { reportError(err); }
}

/**
 * Sale de la casa. Las plantas se quedan en este dispositivo y, con recreate (por defecto),
 * pasan a una casa propia nueva para seguir guardadas en la nube.
 */
export async function leaveHousehold({ recreate = true } = {}) {
  const hid = session.household.id;
  const { uid } = session.user;
  stopListening();
  try {
    await removeFromHouse(hid, uid);
    await fb.F.setDoc(userRef(uid), { householdId: null, updatedAt: fb.F.serverTimestamp() }, { merge: true });
  } catch (err) { throw friendly(err); }
  await db.saveSettings({ linkedHouseholdId: null });
  session.household = null;
  session.remoteComplete = null;
  session.state = 'local';
  emitSession();
  if (recreate) await ensureHousehold();
}

/** Resuelve el caso "este dispositivo tiene plantas y tu cuenta ya tiene casa". */
export async function resolvePendingMerge(withLocal) {
  const hid = session.pendingMerge.householdId;
  try {
    if (withLocal) await uploadAll(hid);
    else await clearLocalShared();
    session.pendingMerge = null;
    await listen(hid);
  } catch (err) { throw friendly(err); }
}

// ------------------------------------------------------------- subir
const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Convierte un registro local en el documento remoto (o null si no se comparte). */
async function toRemote(store, value) {
  if (store === 'species' && value.origin !== 'user') return null;
  const doc = { ...value };
  delete doc.uniqueKey;
  if (store === 'plants') {
    if (doc.coverPhotoId && doc.coverThumbFor !== doc.coverPhotoId) {
      const photo = await db.get('photos', doc.coverPhotoId);
      if (photo?.thumb) {
        doc.coverThumb = await blobToDataURL(photo.thumb);
        doc.coverThumbFor = doc.coverPhotoId;
      }
    }
    if (doc.coverThumb && doc.coverThumb.length > 60000) delete doc.coverThumb;
  }
  return doc;
}

async function push(log) {
  const hid = session.household?.id;
  if (!hid) return;
  for (const entry of log) {
    if (entry.op === 'put') {
      const doc = await toRemote(entry.store, entry.value);
      if (!doc) continue;
      if (entry.store === 'events' && !doc.byUid) Object.assign(doc, { byUid: session.user.uid, byName: session.user.name });
      fb.F.setDoc(itemRef(hid, entry.store, doc.id), doc).catch((e) => reportError(e));
    } else if (entry.op === 'delete' && typeof entry.key === 'string') {
      fb.F.deleteDoc(itemRef(hid, entry.store, entry.key)).catch((e) => reportError(e));
    }
  }
}

function reportError(err) {
  console.error(err);
  session.error = friendly(err).message;
  emitSession();
}

/** Sube todo lo local a la casa. Los eventos antiguos pasan a tener id {tarea}_{fecha}. */
async function uploadAll(hid) {
  const { uid, name } = session.user;
  const ops = [];
  for (const store of db.SHARED_STORES) {
    for (const value of await db.all(store)) {
      let v = value;
      if (store === 'events') {
        if (!v.taskId) continue;
        const id = `${v.taskId}_${v.onDate}`;
        if (v.id !== id) {
          await db.del('events', v.id);
          v = { ...v, id };
          await db.put('events', v, { remote: true });
        }
        v = { ...v, byUid: uid, byName: v.byName || name };
      }
      const doc = await toRemote(store, v);
      if (doc) ops.push([store, doc]);
    }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const b = fb.F.writeBatch(fb.fs);
    for (const [store, doc] of ops.slice(i, i + 400)) b.set(itemRef(hid, store, doc.id), doc);
    await b.commit();
  }
  return ops.length;
}

async function clearLocalShared() {
  await db.tx(db.SHARED_STORES, 'readwrite', async ({ store, req }) => {
    for (const s of db.SHARED_STORES) {
      if (s === 'species') {
        for (const sp of await req(store(s).getAll())) if (sp.origin === 'user') store(s).delete(sp.id);
      } else store(s).clear();
    }
  }, { remote: true });
}

// ------------------------------------------------------------- escuchar
let changeTimer;
function remoteChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('plantas:remote-change')), 250);
}

function stopListening() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

async function listen(hid) {
  stopListening();
  await db.saveSettings({ linkedHouseholdId: hid });
  session.state = 'syncing';
  session.household = { id: hid, name: '', memberUids: [], memberNames: {}, ownerUid: null };
  session.remoteComplete = (taskId, evId, patch, event) => remoteComplete(hid, taskId, evId, patch, event);
  emitSession();

  unsubs.push(fb.F.onSnapshot(hhRef(hid), (snap) => {
    if (!snap.exists() || !snap.data().memberUids.includes(session.user?.uid)) {
      lostHousehold();
      return;
    }
    const d = snap.data();
    session.household = { id: hid, name: d.name, memberUids: d.memberUids, memberNames: d.memberNames || {}, ownerUid: d.ownerUid };
    emitSession();
  }, (err) => (err.code === 'permission-denied' ? lostHousehold() : reportError(err))));

  for (const store of db.SHARED_STORES) {
    let reconciled = false;
    unsubs.push(fb.F.onSnapshot(fb.F.collection(fb.fs, 'households', hid, store), { includeMetadataChanges: true }, async (snap) => {
      const changes = snap.docChanges().filter((c) => c.type !== 'modified' || !c.doc.metadata.hasPendingWrites);
      const fromServer = !snap.metadata.fromCache;
      if (!changes.length && (reconciled || !fromServer)) return;
      await db.tx([store], 'readwrite', async ({ store: s, req }) => {
        for (const c of changes) {
          if (c.type === 'removed') s(store).delete(c.doc.id);
          else s(store).put(store === 'species' ? db.normaliseSpecies({ ...c.doc.data(), origin: 'user' }) : withKey(store, c.doc.data()));
        }
        // La primera vez que llega del servidor: lo que no está en la casa sobra en este dispositivo.
        if (fromServer && !reconciled) {
          const remote = new Set(snap.docs.map((d) => d.id));
          for (const local of await req(s(store).getAll())) {
            if (store === 'species' && local.origin !== 'user') continue;
            if (!remote.has(local.id)) s(store).delete(local.id);
          }
        }
      }, { remote: true });
      if (fromServer && !reconciled) {
        reconciled = true;
        if (store === db.SHARED_STORES.at(-1)) { session.state = 'synced'; emitSession(); }
      }
      remoteChanged();
    }, (err) => reportError(err)));
  }
}

/** Las tareas necesitan su clave única local (tipo y planta) para el índice de IndexedDB. */
function withKey(store, data) {
  if (store === 'tasks') return { ...data, uniqueKey: `${data.plantId}|${data.type}|${data.label || ''}` };
  return data;
}

/** Transacción en la nube: si el evento de hoy ya existe (lo hizo otra persona), no hace nada. */
async function remoteComplete(hid, taskId, evId, patch, event) {
  return fb.F.runTransaction(fb.fs, async (t) => {
    const evRef = itemRef(hid, 'events', evId);
    const existing = await t.get(evRef);
    if (existing.exists()) return { already: true, event: existing.data() };
    t.set(itemRef(hid, 'tasks', taskId), patch, { merge: true });
    t.set(evRef, event);
    return { already: false, event };
  });
}
