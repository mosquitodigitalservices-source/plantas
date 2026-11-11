// Trozos de interfaz que comparten varias pantallas.
import * as db from '../db.js';
import { TASK_TYPES, taskLabel, completeTask, undoTask } from '../care.js';
import { relativeDue, today } from '../dates.js';
import { html, icon, toast } from '../ui.js';
import { photoURL } from '../photos.js';
import { whoText } from '../session.js';

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

/** "Hecha por Ana a las 9:12" / "Hecha por ti" / "Hecha hoy". */
export function doneText(event) {
  const who = event ? whoText(event.byUid, event.byName) : null;
  const at = event?.happenedAt ? ` a las ${timeFmt.format(new Date(event.happenedAt))}` : '';
  return who ? `Hecha por ${who}${at}` : `Hecha hoy${at}`;
}

const taskClass = (t) => (t.type === 'water' || t.type === 'mist' ? 'task--water' : t.type === 'fertilize' ? 'task--fertilize' : '');

/** Fila de tarea. withPlant: muestra el nombre de la planta en el título. */
export function taskRow(task, plant, { withPlant = true, done = false, href = null, every = null, event = null } = {}) {
  const title = withPlant ? `${taskLabel(task)} ${plant.nickname}` : taskLabel(task);
  const overdue = !done && task.nextDueOn < today();
  const due = (done ? doneText(event) : relativeDue(task.nextDueOn)) + (every ? ` · ${every}` : '');
  return html`
    <div class="task ${taskClass(task)} ${overdue ? 'task--overdue' : ''} ${done ? 'task--done' : ''}" data-task="${task.id}">
      <div class="task__icon">${icon(TASK_TYPES[task.type]?.icon || 'check')}</div>
      <div class="task__body">${href ? html`<a class="task__link" href="${href}"><p class="task__title">${title}</p><p class="task__due">${due}</p></a>`
        : html`<p class="task__title">${title}</p><p class="task__due">${due}</p>`}</div>
      <button class="task__check" aria-pressed="${done}" ${done ? 'disabled' : ''} aria-label="Marcar ${title} como hecha">
        <span>${icon('check')}</span>
      </button>
    </div>`;
}

/** Engancha los checks de una lista de tareas. onChange se llama tras marcar o deshacer. */
export function wireTaskList(root, onChange) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('.task__check');
    if (!btn || btn.disabled) return;
    const row = btn.closest('[data-task]');
    btn.disabled = true;
    try {
      const res = await completeTask(row.dataset.task, 'done');
      row.classList.add('task--done');
      btn.setAttribute('aria-pressed', 'true');
      if (res.already) {
        toast(`${doneText(res.event)}. No hace falta repetirla.`, { duration: 6000 });
      } else {
        toast(`${row.querySelector('.task__title').textContent}: hecha`, {
          action: 'Deshacer',
          onAction: async () => { await undoTask(res.event.id, res.previous); onChange?.(); (await import('../app.js')).updateBadge(); },
        });
      }
      onChange?.();
      (await import('../app.js')).updateBadge();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, { error: true });
    }
  });
}

export function plantThumb(photo, alt = '', plant = null) {
  const url = photoURL(photo) || plant?.coverThumb || null;
  return url ? html`<img src="${url}" alt="${alt}">` : icon('leaf');
}

export async function coverPhotos(plants) {
  const ids = plants.map((p) => p.coverPhotoId).filter(Boolean);
  const photos = await Promise.all(ids.map((id) => db.get('photos', id)));
  return new Map(photos.filter(Boolean).map((p) => [p.id, p]));
}

export const navbar = (title, { back, large = !back } = {}) => html`
  <header class="navbar">
    ${back ? html`<a class="btn btn--icon btn--ghost back" href="${back}" aria-label="Atrás">${icon('chevron-left')}</a>` : ''}
    <h1 class="navbar__title ${large ? 'navbar__title--large' : ''}">${title}</h1>
    ${back ? html`<span style="width: 44px" aria-hidden="true"></span>` : ''}
  </header>`;
