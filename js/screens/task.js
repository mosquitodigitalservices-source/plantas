// S10 Recordatorio: crear o editar una tarea (tipo, frecuencia, próxima fecha, activa).
import * as db from '../db.js';
import { TASK_TYPES, taskLabel, saveTasks, intervalFor } from '../care.js';
import { today } from '../dates.js';
import { html, icon, render, sheet, toast, go } from '../ui.js';
import { navbar } from './parts.js';

const UNITS = [['days', 'Días', 1], ['weeks', 'Semanas', 7], ['months', 'Meses', 30]];

async function paint(view, id, query) {
  const isNew = id === 'nueva';
  const catalog = await db.loadCatalog();
  const settings = await db.getSettings();
  let task = isNew ? null : await db.get('tasks', id);
  const plantId = isNew ? query.plant : task?.plantId;
  const plant = plantId ? await db.get('plants', plantId) : null;
  if (!plant || (!isNew && !task)) {
    render(view, html`<div class="screen">${navbar('Recordatorio', { back: '#/plantas' })}<p class="lead">No se encuentra este recordatorio.</p></div>`);
    return;
  }
  const species = plant.speciesId ? await db.get('species', plant.speciesId) : null;
  const care = db.resolveCare(catalog.kinds, species, plant);
  const existing = await db.byIndex('tasks', 'plantId', plantId);
  const usedTypes = new Set(existing.filter((t) => t.type !== 'other').map((t) => t.type));
  if (isNew) {
    const type = Object.keys(TASK_TYPES).find((k) => !usedTypes.has(k)) || 'other';
    task = { id: db.uid(), plantId, type, label: null, intervalDays: 30, seasonal: false, source: 'custom', nextDueOn: today(), enabled: true };
  }
  const auto = !task.intervalDays && ['water', 'fertilize', 'repot'].includes(task.type);
  let days = task.intervalDays || intervalFor(task, care, today(), settings.hemisphere);
  let unit = days % 30 === 0 && days >= 60 ? 'months' : days % 7 === 0 && days >= 14 ? 'weeks' : 'days';
  const unitSize = () => UNITS.find((u) => u[0] === unit)[2];
  let amount = Math.max(1, Math.round(days / unitSize()));
  const back = `#/planta/${plantId}`;

  render(view, html`
    <div class="screen">
      ${navbar(isNew ? 'Nuevo recordatorio' : `${taskLabel(task)} ${plant.nickname}`, { back })}
      <form class="stack" novalidate>
        ${isNew ? html`
          <label class="field"><span class="field__label">Qué hay que hacer</span>
            <select class="input" name="type">${Object.entries(TASK_TYPES).map(([k, v]) => html`<option value="${k}" ${k === task.type ? 'selected' : ''} ${usedTypes.has(k) ? 'disabled' : ''}>${v.label}${usedTypes.has(k) ? ' (ya existe)' : ''}</option>`)}</select></label>` : ''}
        <label class="field" data-label ${task.type === 'other' ? '' : 'hidden'}><span class="field__label">Nombre de la tarea</span>
          <input class="input" name="label" maxlength="40" value="${task.label || ''}" placeholder="Limpiar las hojas, quitar flores secas…"></label>

        <div class="card stack">
          <p class="field__label">Cada cuánto</p>
          ${['water', 'fertilize', 'repot'].includes(task.type) ? html`
            <div class="segmented" role="group" aria-label="Modo de frecuencia" data-mode>
              <button type="button" aria-pressed="${auto}" data-auto="1">Según la planta</button>
              <button type="button" aria-pressed="${!auto}" data-auto="0">Personalizado</button>
            </div>` : ''}
          <p class="t-sm t-muted" data-autotext ${auto ? '' : 'hidden'}>${task.type === 'water'
            ? `Cada ${care.waterDaysWarm} días en primavera y verano, ${care.waterDaysCold} en otoño e invierno.`
            : task.type === 'fertilize' ? `Cada ${care.fertilizeDays || 30} días, solo en los meses de crecimiento.` : `Cada ${care.repotMonths || 24} meses.`}</p>
          <div class="stack" data-custom ${auto ? 'hidden' : ''}>
            <div class="stepper">
              <button type="button" class="btn btn--icon" data-step="-1" aria-label="Menos">${icon('minus')}</button>
              <output class="stepper__value" aria-live="polite" data-amount>${amount}</output>
              <button type="button" class="btn btn--icon" data-step="1" aria-label="Más">${icon('plus')}</button>
            </div>
            <div class="segmented" role="group" aria-label="Unidad" data-units>
              ${UNITS.map(([k, label]) => html`<button type="button" aria-pressed="${k === unit}" data-unit="${k}">${label}</button>`)}
            </div>
          </div>
        </div>

        <label class="field"><span class="field__label">Próxima vez</span>
          <input class="input" type="date" name="next" value="${task.nextDueOn}" min="${today()}" required></label>

        ${!isNew ? html`<label class="list" style="display: block"><span class="list__row"><span>Activo</span><span class="switch"><input type="checkbox" role="switch" name="enabled" ${task.enabled ? 'checked' : ''}></span></span></label>` : ''}

        <button class="btn btn--primary btn--lg btn--block" type="submit">Guardar</button>
        ${!isNew ? html`<button class="btn btn--ghost" type="button" data-action="delete" style="color: var(--c-danger)">Borrar recordatorio</button>` : ''}
      </form>
    </div>`);

  const form = view.querySelector('form');
  let isAuto = auto;
  const out = view.querySelector('[data-amount]');
  const setAmount = (n) => {
    amount = Math.min(unit === 'days' ? 365 : unit === 'weeks' ? 52 : 24, Math.max(1, n));
    out.textContent = amount;
    view.querySelector('[data-step="-1"]').disabled = amount === 1;
  };
  setAmount(amount);
  view.querySelector('[data-step="-1"]').addEventListener('click', () => setAmount(amount - 1));
  view.querySelector('[data-step="1"]').addEventListener('click', () => setAmount(amount + 1));
  view.querySelector('[data-units]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unit]');
    if (!b) return;
    unit = b.dataset.unit;
    view.querySelectorAll('[data-unit]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    setAmount(amount);
  });
  view.querySelector('[data-mode]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    isAuto = b.dataset.auto === '1';
    view.querySelectorAll('[data-auto]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    view.querySelector('[data-custom]').hidden = isAuto;
    view.querySelector('[data-autotext]').hidden = !isAuto;
  });
  form.type?.addEventListener('change', () => {
    // Al cambiar de tipo en uno nuevo, se vuelve a pintar con ese tipo.
    task.type = form.type.value;
    view.querySelector('[data-label]').hidden = task.type !== 'other';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = form.type?.value || task.type;
    const label = type === 'other' ? form.label.value.trim() : null;
    if (type === 'other' && !label) { toast('Ponle un nombre a la tarea', { error: true }); form.label.focus(); return; }
    if (!form.next.value) { toast('Elige la próxima fecha', { error: true }); return; }
    const canAuto = ['water', 'fertilize', 'repot'].includes(type);
    const updated = {
      ...task, type, label,
      intervalDays: canAuto && isAuto ? null : amount * unitSize(),
      seasonal: type === 'water' && isAuto,
      source: canAuto && isAuto ? 'suggested' : 'custom',
      nextDueOn: form.next.value,
      enabled: form.enabled ? form.enabled.checked : true,
    };
    try {
      await saveTasks([updated]);
      toast('Recordatorio guardado');
      go(`/planta/${plantId}`);
    } catch (err) {
      toast(err.name === 'ConstraintError' ? 'Esta planta ya tiene un recordatorio de ese tipo.' : err.message, { error: true });
    }
  });

  view.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const choice = await sheet({
      title: '¿Borrar este recordatorio?',
      text: 'Lo ya anotado en el historial se conserva.',
      actions: [{ key: 'delete', label: 'Borrar', kind: 'danger' }, { key: 'cancel', label: 'Cancelar', kind: 'ghost' }],
    });
    if (choice !== 'delete') return;
    await db.del('tasks', task.id);
    toast('Recordatorio borrado');
    go(`/planta/${plantId}`);
  });
}

export const render_ = (view, { id }, query) => paint(view, id, query);
export { render_ as render };
