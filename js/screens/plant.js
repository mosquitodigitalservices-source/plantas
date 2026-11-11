// S09 Detalle de una planta: cuidados, tratamiento, historial, fotos y notas.
import * as db from '../db.js';
import { loadCareContext, taskLabel, intervalFor, TASK_TYPES } from '../care.js';
import { today } from '../dates.js';
import { html, icon, render, sheet, toast, go } from '../ui.js';
import { photoURL, savePhoto } from '../photos.js';
import { navbar, taskRow, wireTaskList } from './parts.js';
import { LIGHT_TEXT } from './species.js';
import { whoText } from '../session.js';

const ACTION = { done: 'Hecho', skipped: 'Saltado', snoozed: 'Pospuesto' };
const fmtDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

export function everyText(task, care, hemisphere) {
  const n = intervalFor(task, care, today(), hemisphere);
  const months = n / 30;
  const base = n === 1 ? 'cada día'
    : n % 360 === 0 || (Number.isInteger(months) && months % 12 === 0) ? (months / 12 === 1 ? 'cada año' : `cada ${months / 12} años`)
      : n % 30 === 0 && n >= 60 ? `cada ${months} meses`
        : n % 7 === 0 && n >= 14 ? `cada ${n / 7} semanas` : `cada ${n} días`;
  return task.type === 'water' && task.seasonal && !task.intervalDays ? `${base} (según la estación)` : base;
}

async function paint(view, id) {
  const plant = await db.get('plants', id);
  if (!plant || plant.archivedAt) {
    render(view, html`<div class="screen">${navbar('Planta', { back: '#/plantas' })}<p class="lead">Esta planta ya no está en tu lista.</p></div>`);
    return;
  }
  const ctx = await loadCareContext();
  const species = ctx.speciesById.get(plant.speciesId);
  const care = ctx.careOf(plant);
  const [cover, photos, events, treatments, site] = await Promise.all([
    plant.coverPhotoId ? db.get('photos', plant.coverPhotoId) : null,
    db.byIndex('photos', 'plantId', id),
    db.byIndex('events', 'plantId_happenedAt', IDBKeyRange.bound([id, ''], [id, '￿'])),
    db.byIndex('treatments', 'plantId', id),
    plant.siteId ? db.get('sites', plant.siteId) : null,
  ]);
  const tasks = (await db.byIndex('tasks', 'plantId', id)).filter((t) => t.enabled).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));
  const treatment = treatments.find((t) => !t.finishedAt);
  const problem = treatment ? await db.get('problems', treatment.problemId) : null;
  const gallery = photos.filter((p) => p.id !== plant.coverPhotoId).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const history = events.sort((a, b) => b.happenedAt.localeCompare(a.happenedAt)).slice(0, 15);
  const coverUrl = photoURL(cover, 'big') || plant.coverThumb || null;
  const back = `#/planta/${id}`;

  render(view, html`
    <div class="screen">
      ${navbar(plant.nickname, { back: '#/plantas' })}
      ${coverUrl ? html`<img class="hero-photo" src="${coverUrl}" alt="Foto de ${plant.nickname}">` : html`<div class="hero-photo">${icon('leaf')}</div>`}
      <div>
        <p class="t-lg">${db.displayName(species)}</p>
        ${species ? html`<p class="match__sci">${species.scientificName}</p>` : ''}
        ${site ? html`<p class="t-sm t-muted">${site.name}</p>` : ''}
      </div>
      <div class="chip-row">
        <span class="chip chip--water">${icon('water')}Cada ${care.waterDaysWarm} días en verano, ${care.waterDaysCold} en invierno</span>
        <span class="chip chip--accent">${icon('sun')}${LIGHT_TEXT[care.lightNeed][0]}</span>
        <span class="chip">${care.tempMinC}–${care.tempMaxC} °C</span>
        ${species?.toxicPets ? html`<span class="chip chip--danger">Tóxica para mascotas</span>` : ''}
      </div>
      ${species ? html`<a class="btn btn--secondary" href="#/especie/${species.id}?back=${encodeURIComponent(back)}">Ver guía de cuidado</a>` : ''}

      ${treatment ? html`
        <section class="card stack">
          <div class="section__head"><h2 class="t-lg">En tratamiento</h2><span class="chip chip--danger">${problem?.name.es || 'Problema'}</span></div>
          <ol class="steps" data-treatment="${treatment.id}">
            ${treatment.steps.map((s, i) => html`<li><input type="checkbox" id="st-${i}" data-step="${i}" ${s.done ? 'checked' : ''}><span><label for="st-${i}">${s.text}</label></span></li>`)}
          </ol>
          <button class="btn btn--secondary" data-action="finish">Ya está curada</button>
        </section>` : ''}

      <section>
        <div class="section__head"><h2 class="t-lg">Recordatorios</h2><a class="btn btn--ghost btn--sm" href="#/tarea/nueva?plant=${id}">${icon('plus', 'icon--sm')}Añadir</a></div>
        ${tasks.length ? html`<div class="task-list" data-list>${tasks.map((t) => taskRow(t, plant, { withPlant: false, href: `#/tarea/${t.id}`, every: everyText(t, care, ctx.settings.hemisphere) }))}</div>`
          : html`<p class="lead">No tiene recordatorios activos.</p>`}
      </section>

      <div class="actions-row">
        <a class="btn btn--secondary" href="#/diagnostico?plant=${id}">${icon('health', 'icon--sm')}Diagnosticar</a>
        <a class="btn btn--secondary" href="#/luz?plant=${id}">${icon('sun', 'icon--sm')}Medir la luz</a>
      </div>

      <section>
        <div class="section__head"><h2 class="t-lg">Historial</h2></div>
        ${history.length ? html`<ul class="history card">${history.map((e) => html`
            <li>${icon(TASK_TYPES[e.type]?.icon || 'check', 'icon--sm')}<span>${ACTION[e.action]}: ${taskLabel(e).toLowerCase()}${e.byUid ? ` · ${whoText(e.byUid, e.byName)}` : ''}</span><time datetime="${e.happenedAt}">${fmtDate.format(new Date(e.happenedAt))}</time></li>`)}</ul>`
          : html`<p class="lead">Aquí aparecerá lo que vayas haciendo.</p>`}
      </section>

      <section>
        <div class="section__head"><h2 class="t-lg">Fotos</h2><span class="t-sm t-muted">${gallery.length || ''}</span></div>
        <div class="gallery">
          <label class="gallery__add" aria-label="Añadir una foto">${icon('plus')}<input type="file" accept="image/*" data-input="growth"></label>
          ${gallery.map((p) => html`<button class="gallery__item" data-photo="${p.id}" style="padding: 0; border: 0; background: none" aria-label="Foto del ${fmtDate.format(new Date(p.takenAt))}"><img src="${photoURL(p)}" alt=""></button>`)}
        </div>
      </section>

      <section>
        <label class="field"><span class="t-lg">Notas</span>
          <textarea class="input textarea" name="notes" maxlength="2000" placeholder="Dónde la compraste, cambios de sitio, cómo reacciona…">${plant.notes}</textarea></label>
      </section>

      <button class="btn btn--ghost" data-action="archive" style="color: var(--c-danger)">Quitar de mis plantas</button>
    </div>`);

  const list = view.querySelector('[data-list]');
  if (list) wireTaskList(list, () => setTimeout(() => paint(view, id), 350));

  view.querySelector('[data-treatment]')?.addEventListener('change', async (e) => {
    const i = Number(e.target.dataset.step);
    const t = await db.get('treatments', treatment.id);
    t.steps[i].done = e.target.checked;
    await db.put('treatments', t);
  });
  view.querySelector('[data-action="finish"]')?.addEventListener('click', async () => {
    await db.put('treatments', { ...(await db.get('treatments', treatment.id)), finishedAt: new Date().toISOString() });
    await db.put('plants', { ...(await db.get('plants', id)), status: 'healthy' });
    toast(`${plant.nickname} vuelve a estar sana`);
    paint(view, id);
  });

  view.querySelector('[data-input="growth"]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await savePhoto(file, 'growth', id);
      if (!plant.coverPhotoId) await db.put('plants', { ...(await db.get('plants', id)), coverPhotoId: photo.id });
      toast('Foto añadida');
      paint(view, id);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  view.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', async () => {
    const choice = await sheet({
      title: 'Foto',
      actions: [{ key: 'cover', label: 'Usar como portada', kind: 'secondary' }, { key: 'delete', label: 'Borrar foto', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice === 'cover') await db.put('plants', { ...(await db.get('plants', id)), coverPhotoId: b.dataset.photo });
    if (choice === 'delete') await db.del('photos', b.dataset.photo);
    if (choice) paint(view, id);
  }));

  const notes = view.querySelector('[name="notes"]');
  notes.addEventListener('change', async () => {
    await db.put('plants', { ...(await db.get('plants', id)), notes: notes.value });
    toast('Notas guardadas');
  });

  view.querySelector('[data-action="archive"]').addEventListener('click', async () => {
    const choice = await sheet({
      title: `¿Quitar ${plant.nickname}?`,
      text: 'Deja de salir en tus plantas y en los recordatorios. Su historial se conserva en las copias.',
      actions: [{ key: 'archive', label: 'Quitar', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice !== 'archive') return;
    await db.put('plants', { ...(await db.get('plants', id)), archivedAt: new Date().toISOString() });
    toast(`${plant.nickname} quitada`);
    go('/plantas');
  });
}

export const render_ = (view, { id }) => paint(view, id);
export { render_ as render };
