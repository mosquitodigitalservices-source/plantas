// Cuenta y casa compartida: entrar, crear cuenta, crear casa, invitar, unirse, salir, borrar cuenta.
import * as db from '../db.js';
import { session, onSession } from '../session.js';
import { html, icon, render, toast, sheet } from '../ui.js';
import { navbar } from './parts.js';
import { exportBackup } from '../backup.js';

let mode = 'signin'; // signin | signup
let invite = null;   // { code, expiresAt }
let unsub = null;
const sync = () => import('../sync.js');
const STATE = { syncing: 'Sincronizando…', synced: 'Sincronizado', local: 'Sin casa', off: 'Sin cuenta' };

function busy(btn, on) {
  if (!btn) return;
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

function signedOut() {
  return html`
    <div class="segmented" role="group" aria-label="Entrar o crear cuenta">
      <button aria-pressed="${mode === 'signin'}" data-mode="signin">Entrar</button>
      <button aria-pressed="${mode === 'signup'}" data-mode="signup">Crear cuenta</button>
    </div>
    <form class="card stack" data-form="auth" novalidate>
      ${mode === 'signup' ? html`<label class="field"><span class="field__label">Tu nombre</span>
        <span class="field__hint">Es lo que verán los demás de tu casa: "Regada por Ana".</span>
        <input class="input" name="name" maxlength="40" autocomplete="given-name" required></label>` : ''}
      <label class="field"><span class="field__label">Correo</span>
        <input class="input" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span class="field__label">Contraseña</span>
        ${mode === 'signup' ? html`<span class="field__hint">Al menos 6 caracteres.</span>` : ''}
        <input class="input" name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required></label>
      <p class="field__error" data-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${mode === 'signup' ? 'Crear cuenta' : 'Entrar'}</button>
      ${mode === 'signin' ? html`<button class="btn btn--ghost" type="button" data-action="reset">He olvidado la contraseña</button>` : ''}
    </form>
    <p class="list__caption">Sin cuenta la app funciona igual, solo en este dispositivo. Con cuenta puedes compartir tus plantas con la gente de tu casa.</p>`;
}

function joinForm() {
  return html`
      <form class="card stack" data-form="join" novalidate>
        <h2 class="t-lg">Unirme a otra casa</h2>
        <p class="t-sm t-muted">Si vives con alguien que ya usa la app, pídele un código (Ajustes → Cuenta y casa → Invitar).${session.household ? ' Saldrás de tu casa actual.' : ''}</p>
        <label class="field"><span class="field__label">Código</span>
          <input class="input" name="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234" style="text-transform: uppercase; letter-spacing: .2em" required></label>
        <p class="field__error" data-join-error hidden></p>
        <button class="btn btn--secondary" type="submit">Unirme</button>
      </form>`;
}

function householdBlock() {
  const h = session.household;
  if (session.pendingMerge) {
    const n = session.pendingMerge.localPlants;
    return html`
      <div class="notice notice--warning" role="status">${icon('alert')}
        <div class="notice__body">
          <p>Tu cuenta ya tiene casa, y este dispositivo tiene ${n === 1 ? '1 planta propia' : `${n} plantas propias`}. ¿Qué hacemos con ellas?</p>
          <button class="btn btn--sm btn--secondary" data-merge="1">Juntarlas con las de la casa</button>
          <button class="btn btn--sm btn--secondary" data-merge="0">Usar solo las de la casa</button>
        </div></div>`;
  }
  if (!h) {
    return html`
      ${session.error ? '' : html`<p class="lead">Preparando tu casa para guardar tus plantas en la nube…</p>`}
      <form class="card stack" data-form="create" novalidate>
        <h2 class="t-lg">Crear mi casa</h2>
        <p class="t-sm t-muted">Si no se crea sola, créala aquí: tus plantas se guardan en la nube y podrás invitar a quien viva contigo.</p>
        <label class="field"><span class="field__label">Nombre de la casa</span>
          <input class="input" name="name" maxlength="40" value="Casa de ${session.user.name}" required></label>
        <button class="btn btn--primary" type="submit">Crear casa</button>
      </form>
      ${joinForm()}`;
  }
  const members = h.memberUids.map((uid) => ({ uid, name: h.memberNames[uid] || 'Sin nombre' }));
  const isOwner = h.ownerUid === session.user.uid;
  return html`
    <section class="card stack">
      <div class="section__head"><h2 class="t-lg">${h.name || 'Tu casa'}</h2>
        <span class="chip ${session.state === 'synced' ? 'chip--accent' : 'chip--warning'}">${STATE[session.state] || ''}</span></div>
      <ul class="history">${members.map((m) => html`<li>${icon('leaf', 'icon--sm')}<span>${m.name}${m.uid === session.user.uid ? ' (tú)' : ''}</span>${m.uid === h.ownerUid ? html`<time>creó la casa</time>`
        : isOwner && m.uid !== session.user.uid ? html`<button class="btn btn--ghost btn--sm" data-remove="${m.uid}" data-name="${m.name}" style="margin-left: auto; color: var(--c-danger)">Sacar</button>` : ''}</li>`)}</ul>
      ${invite ? html`
        <div class="notice notice--info" role="status"><div class="notice__body">
          <p>Código para unirse: <strong style="font-size: var(--text-xl); letter-spacing: .15em" data-code>${invite.code}</strong></p>
          <p class="t-sm">Sirve para una sola persona y caduca en 48 horas. La otra persona lo escribe en Ajustes → Cuenta y casa → Unirme a otra casa.</p>
          <button class="btn btn--sm btn--secondary" data-action="share">Enviar el código</button>
          <button class="btn btn--sm btn--ghost" data-action="revoke">Anular este código</button>
        </div></div>`
        : html`<button class="btn btn--primary" data-action="invite">${icon('plus', 'icon--sm')}Invitar a alguien</button>`}
      <p class="t-xs t-muted">Las plantas, recordatorios e historial se guardan solos en la nube. Las fotos grandes se quedan en cada móvil; de cada planta se guarda la miniatura.</p>
      ${members.length > 1 ? html`<button class="btn btn--ghost" data-action="leave" style="color: var(--c-danger)">Salir de la casa</button>` : ''}
    </section>
    <details class="collapse"><summary>${icon('plus')}Unirme a otra casa</summary><div class="collapse__body">${joinForm()}</div></details>`;
}

function signedIn() {
  const u = session.user;
  return html`
    <section class="card stack">
      <div><p class="t-lg">${u.name}</p><p class="t-sm t-muted">${u.email}</p></div>
      ${u.verified ? '' : html`<div class="notice notice--info" role="status"><div class="notice__body">
        <p>Te hemos enviado un correo para confirmar tu dirección. Si no llega, mira en spam.</p>
        <button class="btn btn--sm btn--secondary" data-action="verify">Enviarlo otra vez</button></div></div>`}
    </section>
    ${householdBlock()}
    <div class="list">
      <button class="list__row" data-action="signout"><span>Cerrar sesión</span></button>
      <button class="list__row list__row--danger" data-action="delete"><span>Borrar mi cuenta</span></button>
    </div>
    <form class="card stack" data-form="delete" hidden novalidate>
      <p>Para borrar la cuenta, escribe tu contraseña. Sales de la casa y se borra tu cuenta; las plantas de la casa siguen para los demás, y en este dispositivo se queda una copia local.</p>
      <label class="field"><span class="field__label">Contraseña</span>
        <input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn--danger" type="submit">Borrar mi cuenta para siempre</button>
    </form>`;
}

async function paint(view) {
  const focused = document.activeElement;
  if (focused && view.contains(focused) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)) return; // no pisar lo que se escribe
  render(view, html`
    <div class="screen">
      ${navbar('Cuenta y casa', { back: '#/ajustes' })}
      ${session.error ? html`<div class="notice notice--danger" role="alert">${icon('alert')}<div class="notice__body"><p>${session.error}</p></div></div>` : ''}
      ${session.user ? signedIn() : signedOut()}
    </div>`);
  wire(view);
}

function wire(view) {
  const q = (s) => view.querySelector(s);
  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; paint(view); }));

  q('[data-form="auth"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = q('[data-error]');
    err.hidden = true;
    const email = f.email.value.trim();
    const password = f.password.value;
    const name = f.elements.namedItem('name')?.value.trim();
    if (mode === 'signup' && !name) { err.textContent = 'Escribe tu nombre.'; err.hidden = false; return; }
    if (!email || !password) { err.textContent = 'Escribe el correo y la contraseña.'; err.hidden = false; return; }
    const btn = f.querySelector('[type="submit"]');
    busy(btn, true);
    try {
      const s = await sync();
      if (mode === 'signup') await s.signUp(name, email, password);
      else await s.signIn(email, password);
      session.error = null;
      toast(mode === 'signup' ? `Cuenta creada. Hola, ${name}.` : 'Has entrado');
      document.activeElement?.blur();
      paint(view);
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    } finally { busy(btn, false); }
  });

  q('[data-action="reset"]')?.addEventListener('click', async () => {
    const email = q('[name="email"]').value.trim();
    const err = q('[data-error]');
    if (!email) { err.textContent = 'Escribe tu correo arriba y vuelve a pulsar.'; err.hidden = false; return; }
    try {
      await (await sync()).resetPassword(email);
      toast('Si hay una cuenta con ese correo, te hemos enviado un enlace para cambiar la contraseña.', { duration: 7000 });
    } catch (error) { err.textContent = error.message; err.hidden = false; }
  });

  q('[data-action="verify"]')?.addEventListener('click', async () => {
    try { await (await sync()).resendVerification(); toast('Correo enviado'); } catch (error) { toast(error.message, { error: true }); }
  });

  view.querySelectorAll('[data-merge]').forEach((b) => b.addEventListener('click', async () => {
    const withLocal = b.dataset.merge === '1';
    if (!withLocal) {
      const choice = await sheet({
        title: '¿Usar solo las plantas de la casa?',
        text: 'Las plantas de este dispositivo se borrarán de aquí. Haz antes una copia si quieres guardarlas.',
        actions: [{ key: 'backup', label: 'Hacer copia primero', kind: 'secondary' }, { key: 'go', label: 'Borrarlas y usar las de la casa', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
      });
      if (choice === 'backup') { await exportBackup(); return; }
      if (choice !== 'go') return;
    }
    busy(b, true);
    try { await (await sync()).resolvePendingMerge(withLocal); toast('Listo: ya estás sincronizado con tu casa'); } catch (error) { toast(error.message, { error: true }); }
    paint(view);
  }));

  q('[data-form="create"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.currentTarget.elements.namedItem('name').value.trim() || `Casa de ${session.user.name}`;
    const btn = e.currentTarget.querySelector('[type="submit"]');
    busy(btn, true);
    try {
      await (await sync()).createHousehold(name);
      toast('Casa creada. Ahora invita a quien viva contigo.');
      document.activeElement?.blur();
      paint(view);
    } catch (error) { toast(error.message, { error: true }); } finally { busy(btn, false); }
  });

  q('[data-form="join"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = q('[data-join-error]');
    err.hidden = true;
    const btn = f.querySelector('[type="submit"]');
    busy(btn, true);
    try {
      const s = await sync();
      await s.checkInvite(f.code.value);
      const local = (await db.all('plants')).filter((p) => !p.archivedAt).length;
      let withLocal = false;
      if (local) {
        const choice = await sheet({
          title: 'Tienes plantas en este dispositivo',
          text: session.household?.memberUids?.length === 1
            ? '¿Las juntamos con las de la casa nueva? Si no, se borran de aquí y de tu casa actual en la nube (puedes hacer una copia antes).'
            : '¿Las juntamos con las de la casa? Si no, se borran de aquí (puedes hacer una copia antes).',
          actions: [
            { key: 'merge', label: `Juntar mis ${local === 1 ? 'planta' : `${local} plantas`} con la casa`, kind: 'primary' },
            { key: 'drop', label: 'Usar solo las de la casa', kind: 'secondary' },
            { key: 'cancel', label: 'Cancelar', kind: 'ghost' },
          ],
        });
        if (!choice) return;
        withLocal = choice === 'merge';
      }
      await s.joinHousehold(f.code.value, withLocal);
      toast('Ya estás en la casa');
      document.activeElement?.blur();
      paint(view);
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    } finally { busy(btn, false); }
  });

  q('[data-action="invite"]')?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try {
      invite = { code: await (await sync()).createInvite() };
      paint(view);
    } catch (error) { toast(error.message, { error: true }); busy(e.currentTarget, false); }
  });

  q('[data-action="revoke"]')?.addEventListener('click', async () => {
    try { await (await sync()).revokeInvite(invite.code); invite = null; toast('Código anulado: ya no sirve para entrar'); } catch (error) { toast(error.message, { error: true }); }
    paint(view);
  });

  view.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const choice = await sheet({
      title: `¿Sacar a ${b.dataset.name} de la casa?`,
      text: 'Dejará de ver y cambiar las plantas de esta casa. En su móvil se queda una copia en una casa solo suya.',
      actions: [{ key: 'remove', label: 'Sacar de la casa', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice !== 'remove') return;
    try { await (await sync()).removeMember(b.dataset.remove); toast(`${b.dataset.name} ya no está en la casa`); } catch (error) { toast(error.message, { error: true }); }
  }));

  q('[data-action="share"]')?.addEventListener('click', async () => {
    const text = `Únete a mi casa en Plantas: abre ${location.origin}${location.pathname}, crea tu cuenta y en Ajustes → Cuenta y casa escribe el código ${invite.code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Copiado'); }
    } catch { /* cancelado */ }
  });

  q('[data-action="leave"]')?.addEventListener('click', async () => {
    const last = session.household.memberUids.length <= 1;
    const choice = await sheet({
      title: '¿Salir de la casa?',
      text: last ? 'Eres la única persona: tus plantas pasarán a una casa nueva solo tuya.'
        : `Dejarás de ver los cambios de los demás. Te llevas una copia de las plantas a una casa nueva solo tuya.${session.household.ownerUid === session.user.uid ? ' La casa pasará a otro miembro.' : ''}`,
      actions: [{ key: 'leave', label: 'Salir', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice !== 'leave') return;
    try { await (await sync()).leaveHousehold(); invite = null; toast('Has salido. Tus plantas están en tu casa nueva.'); } catch (error) { toast(error.message, { error: true }); }
    paint(view);
  });

  q('[data-action="signout"]')?.addEventListener('click', async () => {
    const choice = await sheet({
      title: '¿Cerrar sesión?',
      text: 'Las plantas siguen en este dispositivo, pero sin sincronizar con tu casa hasta que vuelvas a entrar.',
      actions: [{ key: 'out', label: 'Cerrar sesión', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice !== 'out') return;
    await (await sync()).signOut();
    invite = null;
    toast('Sesión cerrada');
  });

  q('[data-action="delete"]')?.addEventListener('click', () => {
    const f = q('[data-form="delete"]');
    f.hidden = false;
    f.password.focus();
  });
  q('[data-form="delete"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('[type="submit"]');
    busy(btn, true);
    try {
      await (await sync()).deleteAccount(e.currentTarget.password.value);
      invite = null;
      toast('Cuenta borrada');
    } catch (error) { toast(error.message, { error: true }); } finally { busy(btn, false); }
  });
}

export async function render_(view) {
  unsub?.();
  unsub = onSession(() => { if (location.hash.startsWith('#/cuenta')) paint(view); else { unsub?.(); unsub = null; } });
  await paint(view);
}
export { render_ as render };
