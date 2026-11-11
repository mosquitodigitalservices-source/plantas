// S08 Mis plantas.
import * as db from '../db.js';
import { loadCareContext, taskLabel } from '../care.js';
import { relativeDue, today } from '../dates.js';
import { html, icon, render, emptyState } from '../ui.js';
import { navbar, plantThumb, coverPhotos } from './parts.js';

export async function render_(view) {
  const ctx = await loadCareContext();
  const photos = await coverPhotos(ctx.plants);
  const nextTask = new Map();
  for (const t of ctx.tasks) {
    const cur = nextTask.get(t.plantId);
    if (!cur || t.nextDueOn < cur.nextDueOn) nextTask.set(t.plantId, t);
  }
  const plants = [...ctx.plants].sort((a, b) => a.nickname.localeCompare(b.nickname, 'es'));

  const card = (p) => {
    const t = nextTask.get(p.id);
    const overdue = t && t.nextDueOn < today();
    const meta = t ? `${taskLabel(t)}: ${relativeDue(t.nextDueOn).toLowerCase()}` : 'Sin tareas';
    const species = ctx.speciesById.get(p.speciesId);
    return html`
      <a class="plant-card ${overdue ? 'plant-card--overdue' : ''} ${p.status === 'treating' ? 'plant-card--treating' : ''}" href="#/planta/${p.id}">
        <div class="plant-card__photo">${plantThumb(photos.get(p.coverPhotoId), '', p)}</div>
        <p class="plant-card__name">${p.nickname}</p>
        <p class="plant-card__meta t-xs t-muted">${meta}</p>
        <span class="sr-only">${db.displayName(species)}</span>
      </a>`;
  };

  render(view, html`
    <div class="screen">
      ${navbar('Mis plantas')}
      ${plants.length
        ? html`<p class="lead" style="margin-top: calc(var(--space-4) * -1)">${plants.length === 1 ? '1 planta' : `${plants.length} plantas`}</p>
           <div class="plant-grid">${plants.map(card)}</div>
           <a class="btn btn--secondary btn--block" href="#/camara">${icon('plus', 'icon--sm')}Añadir otra planta</a>`
        : emptyState({
          iconName: 'leaf', title: 'Todavía no hay plantas',
          text: 'Haz una foto a una de tus plantas y la añadimos con su calendario de cuidados.',
          action: html`<a class="btn btn--primary" href="#/camara">${icon('camera', 'icon--sm')}Hacer una foto</a>`,
        })}
    </div>`);
}

export { render_ as render };
