// S16 Ajustes (corte vertical: clave de Pl@ntNet, aviso diario, hemisferio y exportar al Calendario).
import * as db from '../db.js';
import { checkKey } from '../identify.js';
import { exportCalendar, calendarStatus, CALENDAR_DAYS } from '../calendar.js';
import { parseLocal } from '../dates.js';
import { html, icon, render, toast, sheet } from '../ui.js';
import { exportBackup, readBackup, importBackup, wipeAll, backupAge } from '../backup.js';
import { navbar } from './parts.js';
import { session } from '../session.js';

const fmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

async function paint(view) {
  const { startupErrors } = await import('../app.js');
  const cacheNames = await (globalThis.caches?.keys?.() ?? Promise.resolve([])).catch(() => []);
  const diag = {
    errors: startupErrors,
    version: cacheNames.find((k) => k.startsWith('plantas-'))?.slice(8) || 'local',
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  };
  const [s, status] = await Promise.all([db.getSettings(), calendarStatus()]);
  const cloud = !!session.household;
  const age = backupAge(s);
  const ageText = age == null ? 'Nunca' : age === 0 ? 'Hoy' : age === 1 ? 'Ayer' : `Hace ${age} días`;
  const calText = s.calendarUntil
    ? status.state === 'stale' ? 'Desactualizado' : `Hasta el ${fmt.format(parseLocal(s.calendarUntil))}`
    : 'Sin exportar';

  render(view, html`
    <div class="screen">
      ${navbar('Ajustes')}

      <a class="list" href="#/cuenta" style="display: block; text-decoration: none; color: inherit">
        <span class="list__row"><span>Cuenta y casa</span><span class="list__value">${session.user ? (session.household ? session.household.name || 'En una casa' : session.user.name) : 'Sin cuenta'}</span>${icon('chevron-right')}</span>
      </a>

      <section>
        <h2 class="t-lg" style="margin-bottom: var(--space-2)">Identificación</h2>
        <form class="card stack" data-form="key" novalidate>
          <label class="field"><span class="field__label">Clave de Pl@ntNet</span>
            <span class="field__hint">Gratis en my.plantnet.org. En Settings > API key, activa "expose my API key" y añade ${location.origin} en "Authorized domains". La clave solo se guarda en este iPhone.</span>
            <input class="input" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" value="${s.plantnetKey || ''}" aria-describedby="key-msg"></label>
          <p class="field__error" id="key-msg" hidden></p>
          <div class="row" style="display: flex; gap: var(--space-2)">
            <button class="btn btn--primary" type="submit">Guardar</button>
            ${s.plantnetKey ? html`<button class="btn btn--ghost" type="button" data-action="clear">Quitar clave</button>` : ''}
          </div>
          ${s.plantnetRemaining != null ? html`<p class="footnote">Te quedan ${s.plantnetRemaining} identificaciones hoy.</p>` : ''}
        </form>
      </section>

      <section>
        <h2 class="t-lg" style="margin-bottom: var(--space-2)">Recordatorios</h2>
        <div class="list">
          <label class="list__row"><span>Hora del aviso</span><input class="input" type="time" name="digestTime" value="${s.digestTime}" style="width: auto; min-height: 36px"></label>
          <label class="list__row"><span>Vivo en el hemisferio sur</span><span class="switch"><input type="checkbox" role="switch" name="south" ${s.hemisphere === 'south' ? 'checked' : ''}></span></label>
          <button class="list__row" data-action="export"><span>Exportar al Calendario</span><span class="list__value">${calText}</span>${icon('download')}</button>
        </div>
        <p class="list__caption">Crea un evento con alarma para cada día con tareas durante los próximos ${CALENDAR_DAYS} días. Al abrir el archivo, añádelo a un calendario llamado "Plantas". Si cambias tareas, borra ese calendario y vuelve a exportar.</p>
      </section>

      <section>
        <h2 class="t-lg" style="margin-bottom: var(--space-2)">Tus datos</h2>
        <div class="list">
          <button class="list__row" data-action="backup"><span>${cloud ? 'Exportar copia en archivo' : 'Hacer copia'}</span><span class="list__value">${ageText}</span>${icon('download')}</button>
          <label class="list__row"><span>Restaurar una copia</span>${icon('upload')}<input type="file" accept="application/json,.json" data-input="restore" class="sr-only"></label>
          <button class="list__row list__row--danger" data-action="wipe"><span>Borrar todos los datos</span></button>
        </div>
        <p class="list__caption">${cloud
          ? 'Tus plantas, recordatorios e historial se guardan solos en tu cuenta. Las fotos grandes solo están en este dispositivo: de cada planta se guarda en la nube la miniatura de la portada. La copia en archivo es opcional e incluye las fotos.'
          : 'Sin cuenta, tus plantas y fotos solo están en este dispositivo, y iOS puede borrar los datos de las webs. Crea una cuenta (Cuenta y casa, arriba) y se guardarán solas; o guarda una copia en archivo de vez en cuando.'} La clave de Pl@ntNet no se incluye en ninguna copia.</p>
      </section>

      <details class="collapse">
        <summary>${icon('alert')}Diagnóstico</summary>
        <div class="collapse__body stack">
          ${diag.errors.length ? html`<ul style="margin: 0; padding-left: var(--space-5)">${diag.errors.map((e) => html`<li>Al ${e.label}: <strong>${e.name}</strong> — ${e.message}</li>`)}</ul>`
            : html`<p>El arranque no ha dado errores.</p>`}
          ${session.error ? html`<p>Cuenta: ${session.error}</p>` : ''}
          <p class="t-xs">Versión ${diag.version} · ${diag.standalone ? 'app instalada' : 'navegador'} · cuenta: ${session.state}</p>
          <p class="t-xs" style="word-break: break-all">${navigator.userAgent}</p>
        </div>
      </details>

      <p class="footnote">Identificación de plantas con la API de Pl@ntNet.</p>
    </div>`);

  view.querySelector('[data-action="backup"]').addEventListener('click', async (e) => {
    const row = e.currentTarget;
    row.setAttribute('aria-busy', 'true');
    try {
      const res = await exportBackup();
      if (!res.cancelled) toast(`Copia hecha: ${res.plants} plantas y ${res.photos} fotos (${(res.bytes / 1048576).toFixed(1)} MB).`);
      paint(view);
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      row.removeAttribute('aria-busy');
    }
  });
  view.querySelector('[data-input="restore"]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { data, summary } = await readBackup(file);
      const when = summary.exportedAt ? new Date(summary.exportedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'fecha desconocida';
      const choice = await sheet({
        title: '¿Restaurar esta copia?',
        text: `Copia del ${when}: ${summary.plants} plantas, ${summary.photos} fotos y ${summary.events} cuidados anotados. Sustituye todo lo que hay ahora en este dispositivo.`,
        actions: [{ key: 'restore', label: 'Restaurar', kind: 'primary' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
      });
      if (choice !== 'restore') return;
      await importBackup(data);
      toast('Copia restaurada');
      paint(view);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  view.querySelector('[data-action="wipe"]').addEventListener('click', async () => {
    const choice = await sheet({
      title: '¿Borrar todos los datos?',
      text: 'Se borran tus plantas, fotos e historial de este dispositivo. No se puede deshacer. Antes puedes hacer una última copia.',
      actions: [
        { key: 'backup', label: 'Hacer copia primero', kind: 'secondary' },
        { key: 'wipe', label: 'Borrar todo', kind: 'danger' },
        { key: 'cancel', label: 'Cancelar', kind: 'ghost' },
      ],
    });
    if (choice === 'backup') { view.querySelector('[data-action="backup"]').click(); return; }
    if (choice !== 'wipe') return;
    await wipeAll();
    toast('Datos borrados');
    paint(view);
  });

  const form = view.querySelector('[data-form="key"]');
  const msg = view.querySelector('#key-msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = form.key.value.trim();
    msg.hidden = true;
    form.key.removeAttribute('aria-invalid');
    if (!key) { msg.textContent = 'Escribe la clave o usa "Quitar clave".'; msg.hidden = false; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.setAttribute('aria-busy', 'true');
    const res = await checkKey(key);
    btn.removeAttribute('aria-busy');
    if (!res.ok) {
      msg.textContent = res.message;
      msg.hidden = false;
      form.key.setAttribute('aria-invalid', 'true');
      return;
    }
    await db.saveSettings({ plantnetKey: key });
    toast('Clave guardada');
    paint(view);
  });
  view.querySelector('[data-action="clear"]')?.addEventListener('click', async () => {
    await db.saveSettings({ plantnetKey: null, plantnetRemaining: null });
    toast('Clave quitada: los resultados serán de ejemplo');
    paint(view);
  });
  view.querySelector('[name="digestTime"]').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    await db.saveSettings({ digestTime: e.target.value });
    toast('Hora guardada. Vuelve a exportar el calendario para que se aplique.');
  });
  view.querySelector('[name="south"]').addEventListener('change', async (e) => {
    await db.saveSettings({ hemisphere: e.target.checked ? 'south' : 'north' });
    toast(e.target.checked ? 'Hemisferio sur' : 'Hemisferio norte');
  });
  view.querySelector('[data-action="export"]').addEventListener('click', async () => {
    try {
      const { eventCount } = await exportCalendar();
      toast(eventCount ? `Calendario exportado: ${eventCount} días con aviso.` : 'No hay tareas que exportar todavía.');
      paint(view);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

export const render_ = (view) => paint(view);
export { render_ as render };
