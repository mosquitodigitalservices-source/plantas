// S03 Hoy: avisos y tareas del día.
import { todayAgenda } from '../care.js';
import { calendarStatus, exportCalendar } from '../calendar.js';
import { longDay, today, parseLocal } from '../dates.js';
import { html, icon, render, emptyState, toast, sheet } from '../ui.js';
import { navbar, taskRow, wireTaskList } from './parts.js';
import { updateBadge } from '../app.js';
import { exportBackup, backupAge } from '../backup.js';
import { session } from '../session.js';
import { NEW_URL, isOldAddress, wipeThisAddress } from '../moved.js';

const fmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

function calendarNotice(status) {
  if (status.state === 'ok') return '';
  const text = {
    never: 'Para que el iPhone te avise aunque la app esté cerrada, añade tus tareas al Calendario.',
    stale: status.reason === 'expired'
      ? 'Tu calendario de plantas se ha terminado. Expórtalo de nuevo para seguir recibiendo avisos.'
      : 'Has cambiado tareas y el Calendario del iPhone no lo sabe. Vuelve a exportarlo.',
    ending: `Tu calendario de plantas termina el ${status.until ? fmt.format(parseLocal(status.until)) : ''}. Expórtalo de nuevo para seguir recibiendo avisos.`,
  }[status.state];
  return html`
    <div class="notice ${status.state === 'never' ? 'notice--info' : 'notice--warning'}" role="status">
      ${icon('calendar')}
      <div class="notice__body"><p>${text}</p>
        <button class="btn btn--sm btn--secondary" data-action="export">${status.state === 'never' ? 'Añadir al Calendario' : 'Exportar de nuevo'}</button>
      </div>
    </div>`;
}

function movedNotice() {
  if (!isOldAddress()) return '';
  return html`
    <div class="notice notice--warning" role="status">${icon('alert')}
      <div class="notice__body">
        <p><strong>La app se ha mudado</strong> a una dirección propia, más segura: <strong>plantas-d89b6.web.app</strong>.</p>
        <p class="t-sm">1. Si tienes fotos que quieres conservar, haz antes una copia aquí. 2. Abre la nueva dirección en Safari, añádela a la pantalla de inicio y entra con tu cuenta (o restaura la copia). 3. Vuelve aquí y borra los datos de esta dirección.</p>
        <a class="btn btn--sm btn--primary" href="${NEW_URL}" target="_blank" rel="noopener">Abrir la nueva dirección</a>
        <button class="btn btn--sm btn--secondary" data-action="backup">Hacer copia</button>
        <button class="btn btn--sm btn--ghost" data-action="wipe-old">Ya me he mudado: borrar los datos de aquí</button>
      </div>
    </div>`;
}

function backupNotice(settings) {
  // Con cuenta, todo se guarda solo en la nube: no hace falta avisar.
  if (session.user) return '';
  const age = backupAge(settings);
  if (age != null && age < 7) return '';
  return html`
    <div class="notice notice--warning" role="status">${icon('alert')}
      <div class="notice__body">
        <p>Tus plantas solo están en este dispositivo. Crea una cuenta y se guardarán solas en la nube, aunque no compartas con nadie.</p>
        <a class="btn btn--sm btn--secondary" href="#/cuenta">Crear cuenta</a>
        <button class="btn btn--sm btn--ghost" data-action="backup">O guardar una copia en archivo</button>
      </div>
    </div>`;
}

export async function render_(view) {
  const [agenda, status] = await Promise.all([todayAgenda(), calendarStatus()]);
  const { pending, done, plants, plantById } = agenda;
  let body;
  if (!plants.length) {
    body = emptyState({
      iconName: 'leaf', title: 'Todavía no hay plantas',
      text: 'Haz una foto a una de tus plantas: te diremos cuál es y cuándo regarla.',
      action: html`<a class="btn btn--primary" href="#/camara">${icon('camera', 'icon--sm')}Hacer una foto</a>`,
    });
  } else if (!pending.length && !done.length) {
    body = html`<section class="section"><div class="card empty" style="padding-block: var(--space-6)">
      <div class="empty__art">${icon('check')}</div><h2 class="t-lg">Nada que hacer hoy</h2><p>Tus plantas están al día.</p></div></section>`;
  } else {
    body = html`
      <section>
        <div class="section__head"><h2 class="t-lg">Pendiente</h2><span class="t-sm t-muted">${pending.length}</span></div>
        ${pending.length ? html`<div class="task-list" data-list>${pending.map((t) => taskRow(t, plantById.get(t.plantId)))}</div>`
          : html`<p class="lead">Todo hecho por hoy.</p>`}
      </section>
      ${done.length ? html`<section>
        <div class="section__head"><h2 class="t-lg">Hecho hoy</h2></div>
        <div class="task-list" data-list>${done.map((t) => taskRow(t, plantById.get(t.plantId), { done: true, event: t.event }))}</div>
      </section>` : ''}`;
  }
  const day = longDay(today());
  render(view, html`
    <div class="screen">
      ${navbar('Hoy')}
      <p class="lead" style="margin-top: calc(var(--space-4) * -1)">${day[0].toUpperCase() + day.slice(1)}</p>
      ${movedNotice()}
      ${plants.length ? backupNotice(agenda.settings) : ''}
      ${plants.length ? calendarNotice(status) : ''}
      ${body}
    </div>`);

  view.querySelectorAll('[data-list]').forEach((list) => wireTaskList(list, () => setTimeout(() => render_(view).then(updateBadge), 350)));
  view.querySelector('[data-action="wipe-old"]')?.addEventListener('click', async () => {
    const choice = await sheet({
      title: '¿Borrar los datos de esta dirección?',
      text: 'Se cierra la sesión y se borran las plantas, fotos y ajustes guardados en esta dirección antigua. Hazlo solo cuando ya los tengas en la nueva (con tu cuenta o con una copia).',
      actions: [{ key: 'wipe', label: 'Borrar los datos de aquí', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice !== 'wipe') return;
    await wipeThisAddress();
    document.body.innerHTML = '';
    const p = document.createElement('p');
    p.style.cssText = 'padding: 24px; font: 17px/1.5 system-ui';
    p.textContent = 'Listo: esta dirección ya no guarda nada. Usa la app en plantas-d89b6.web.app y borra este icono de la pantalla de inicio.';
    document.body.append(p);
  });
  view.querySelector('[data-action="backup"]')?.addEventListener('click', async () => {
    try {
      const res = await exportBackup();
      if (!res.cancelled) toast(`Copia hecha: ${res.plants} plantas y ${res.photos} fotos.`);
      render_(view);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  view.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    try {
      const { eventCount } = await exportCalendar();
      toast(`Calendario exportado: ${eventCount} días con aviso. Ábrelo y añádelo al calendario "Plantas".`, { duration: 7000 });
      render_(view);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

export { render_ as render };
