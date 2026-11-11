// S11 Calendario: vista de mes (con puntos en los días con tareas) y de semana (lista de 7 días).
import * as db from '../db.js';
import { forecast, loadCareContext, taskLabel } from '../care.js';
import { calendarStatus, exportCalendar, CALENDAR_DAYS } from '../calendar.js';
import { today, addDays, parseLocal, toLocalDate, longDay, diffDays } from '../dates.js';
import { html, icon, render, toast } from '../ui.js';
import { navbar } from './parts.js';

const monthFmt = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

let state = { mode: 'month', month: null, selected: null };

async function paint(view) {
  const t0 = today();
  state.month ||= t0.slice(0, 7);
  state.selected ||= t0;
  const ctx = await loadCareContext();
  const [y, m] = state.month.split('-').map(Number);
  const first = toLocalDate(new Date(y, m - 1, 1, 12));
  const daysInMonth = new Date(y, m, 0).getDate();
  const last = toLocalDate(new Date(y, m - 1, daysInMonth, 12));
  // Previsión desde hoy hasta el final del mes visible (o 7 días en la vista de semana).
  const horizon = state.mode === 'week' ? addDays(t0, 6) : last;
  const days = horizon >= t0 ? forecast(ctx, diffDays(horizon, t0) + 1, t0) : {};
  // Lo ya hecho en el pasado, desde el historial.
  const events = (await db.all('events')).filter((e) => e.action === 'done' && ctx.plantById.has(e.plantId));
  const doneByDay = {};
  for (const e of events) (doneByDay[e.onDate] ||= []).push(e);
  const status = await calendarStatus();

  const doneItems = (date) => (doneByDay[date] || []).map((e) => ({ label: `${taskLabel(e)} ${ctx.plantById.get(e.plantId).nickname}`, done: true, plantId: e.plantId }));
  const pendingItems = (date) => (days[date] || []).map(({ task, plant }) => ({ label: `${taskLabel(task)} ${plant.nickname}`, done: false, plantId: plant.id, type: task.type }));
  // Pasado: lo que hiciste. Hoy: lo hecho y lo pendiente. Futuro: la previsión.
  const itemsFor = (date) => (date < t0 ? doneItems(date) : date === t0 ? [...pendingItems(date), ...doneItems(date)] : pendingItems(date));
  const list = (date) => {
    const items = itemsFor(date);
    if (!items.length) return html`<p class="lead">${date < t0 ? 'No anotaste nada este día.' : 'Nada que hacer.'}</p>`;
    return html`<ul class="history card">${items.map((i) => html`<li>${icon(i.done ? 'check' : i.type === 'fertilize' ? 'fertilize' : i.type === 'water' ? 'water' : 'leaf', 'icon--sm')}<a href="#/planta/${i.plantId}" style="color: inherit; text-decoration: none">${i.label}</a></li>`)}</ul>`;
  };

  let body;
  if (state.mode === 'month') {
    const lead = (parseLocal(first).getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(html`<span class="cal__day cal__day--out" aria-hidden="true"></span>`);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = toLocalDate(new Date(y, m - 1, d, 12));
      const n = itemsFor(date).length;
      cells.push(html`<button class="cal__day ${date === t0 ? 'cal__day--today' : ''}" data-date="${date}" aria-pressed="${date === state.selected}" ${n ? 'data-tasks' : ''} aria-label="${d} de ${monthFmt.format(parseLocal(date)).split(' ')[0]}${n ? `, ${n} ${date < t0 ? 'hechas' : 'tareas'}` : ''}">${d}</button>`);
    }
    body = html`
      <div class="cal">
        <div class="cal__head">
          <button class="btn btn--icon btn--ghost" data-nav="-1" aria-label="Mes anterior">${icon('chevron-left')}</button>
          <p class="t-lg">${cap(monthFmt.format(parseLocal(first)))}</p>
          <button class="btn btn--icon btn--ghost" data-nav="1" aria-label="Mes siguiente">${icon('chevron-right')}</button>
        </div>
        <div class="cal__grid">${DOW.map((d) => html`<span class="cal__dow" aria-hidden="true">${d}</span>`)}${cells}</div>
      </div>
      <section class="stack">
        <h2 class="t-lg">${cap(longDay(state.selected))}</h2>
        ${list(state.selected)}
      </section>`;
  } else {
    const week = Array.from({ length: 7 }, (_, i) => addDays(t0, i)).filter((date) => date === t0 || itemsFor(date).length);
    body = html`${week.map((date) => html`
      <section class="stack">
        <h2 class="t-lg">${date === t0 ? 'Hoy' : date === addDays(t0, 1) ? 'Mañana' : cap(longDay(date))}</h2>
        ${list(date)}
      </section>`)}
      ${week.length === 1 ? html`<p class="lead">Nada más en los próximos 7 días.</p>` : ''}`;
  }

  render(view, html`
    <div class="screen">
      ${navbar('Calendario')}
      <div class="segmented" role="group" aria-label="Vista">
        <button aria-pressed="${state.mode === 'month'}" data-mode="month">Mes</button>
        <button aria-pressed="${state.mode === 'week'}" data-mode="week">Semana</button>
      </div>
      ${body}
      <section class="list">
        <button class="list__row" data-action="export"><span>Exportar al Calendario del iPhone</span>
          <span class="list__value">${status.state === 'ok' ? 'Al día' : status.state === 'never' ? 'Sin exportar' : 'Desactualizado'}</span>${icon('download')}</button>
      </section>
      <p class="list__caption">Los días futuros son una previsión: si riegas antes o después, se recalculan. El aviso del iPhone cubre ${CALENDAR_DAYS} días.</p>
    </div>`);

  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; paint(view); }));
  view.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const d = new Date(y, m - 1 + Number(b.dataset.nav), 1, 12);
    state.month = toLocalDate(d).slice(0, 7);
    paint(view);
  }));
  view.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => { state.selected = b.dataset.date; paint(view); }));
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
