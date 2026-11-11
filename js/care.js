// Tareas de cuidado: sugerencias, vencimientos, completar y previsión para el calendario.
import * as db from './db.js';
import { today, addDays, isWarm, northMonth, parseLocal, toLocalDate } from './dates.js';
import { session } from './session.js';

export const TASK_TYPES = {
  water: { label: 'Regar', icon: 'water' },
  fertilize: { label: 'Abonar', icon: 'fertilize' },
  prune: { label: 'Podar', icon: 'prune' },
  propagate: { label: 'Propagar', icon: 'leaf' },
  repot: { label: 'Trasplantar', icon: 'repot' },
  mist: { label: 'Pulverizar', icon: 'water' },
  rotate: { label: 'Girar', icon: 'sun' },
  other: { label: 'Otra tarea', icon: 'check' },
};

export const taskLabel = (task) => (task.type === 'other' && task.label) || TASK_TYPES[task.type]?.label || 'Tarea';

/** Días hasta la siguiente vez, contando desde la fecha "from". */
export function intervalFor(task, care, from, hemisphere) {
  if (task.intervalDays) return task.intervalDays;
  if (task.type === 'water') {
    if (!task.seasonal) return care.waterDaysWarm;
    return isWarm(from, hemisphere) ? care.waterDaysWarm : care.waterDaysCold;
  }
  if (task.type === 'fertilize') return care.fertilizeDays || 30;
  if (task.type === 'repot') return (care.repotMonths || 24) * 30;
  return 30;
}

/** El abono solo se programa en los meses de crecimiento: si cae fuera, pasa al primer día del siguiente mes válido. */
export function alignToGrowth(date, care, hemisphere) {
  const months = care.fertilizeMonths;
  if (!months?.length) return date;
  let d = date;
  for (let i = 0; i < 12; i++) {
    if (months.includes(northMonth(d, hemisphere))) return d;
    const p = parseLocal(d);
    d = toLocalDate(new Date(p.getFullYear(), p.getMonth() + 1, 1, 12));
  }
  return date;
}

export function nextDue(task, care, from, hemisphere) {
  const next = addDays(from, intervalFor(task, care, from, hemisphere));
  return task.type === 'fertilize' ? alignToGrowth(next, care, hemisphere) : next;
}

const uniqueKey = (plantId, type, label) => `${plantId}|${type}|${label || ''}`;

/**
 * Tareas sugeridas para una planta nueva.
 * lastWatered: 'today' | 'days' (hace unos días) | 'unknown'
 */
export function suggestTasks(plant, care, hemisphere, lastWatered = 'unknown') {
  const t0 = today();
  const make = (type, nextDueOn, extra = {}) => ({
    id: db.uid(), plantId: plant.id, type, label: null, intervalDays: null, seasonal: true,
    source: 'suggested', nextDueOn, enabled: true, uniqueKey: uniqueKey(plant.id, type, null), ...extra,
  });
  const water = make('water', t0);
  if (lastWatered === 'today') water.nextDueOn = nextDue(water, care, t0, hemisphere);
  if (lastWatered === 'days') water.nextDueOn = addDays(t0, Math.max(1, Math.round(intervalFor(water, care, t0, hemisphere) / 2)));
  const tasks = [water];
  if (care.fertilizeDays) {
    const f = make('fertilize', null);
    f.nextDueOn = alignToGrowth(addDays(t0, 7), care, hemisphere);
    tasks.push(f);
  }
  if (care.repotMonths) tasks.push(make('repot', addDays(t0, care.repotMonths * 30)));
  return tasks;
}

export async function saveTasks(tasks) {
  await db.tx(['tasks'], 'readwrite', ({ store }) => {
    const now = new Date().toISOString();
    for (const t of tasks) store('tasks').put({ createdAt: now, ...t, updatedAt: now, uniqueKey: uniqueKey(t.plantId, t.type, t.label) });
  });
}

export const eventId = (taskId, onDate) => `${taskId}_${onDate}`;

/**
 * Marca una tarea como hecha, saltada o pospuesta. Un solo evento por tarea y día (id determinista):
 * si ya existe (lo hizo otra persona de la casa o tú en otro dispositivo), no hace nada y devuelve
 * { already: true, event } con quién lo hizo.
 * Con casa y conexión, la comprobación se hace en una transacción de Firestore (session.remoteComplete).
 */
export async function completeTask(taskId, action = 'done', { snoozeDays = 1 } = {}) {
  const [settings, catalog] = await Promise.all([db.getSettings(), db.loadCatalog()]);
  const onDate = today();
  const id = eventId(taskId, onDate);
  const now = new Date().toISOString();
  const who = session.user ? { byUid: session.user.uid, byName: session.user.name } : { byUid: null, byName: null };

  // Prepara el cambio con los datos locales.
  const prep = await db.tx(['tasks', 'events', 'plants', 'species'], 'readonly', async ({ store, req }) => {
    const task = await req(store('tasks').get(taskId));
    if (!task) throw new Error('La tarea ya no existe');
    const existing = (await req(store('events').get(id))) || (await req(store('events').index('taskDay').get([taskId, onDate])));
    const plant = await req(store('plants').get(task.plantId));
    const species = plant?.speciesId ? await req(store('species').get(plant.speciesId)) : null;
    return { task, existing, care: db.resolveCare(catalog.kinds, species, plant) };
  });
  if (prep.existing) return { task: prep.task, event: prep.existing, already: true };

  const { task, care } = prep;
  const previous = { nextDueOn: task.nextDueOn, lastDoneOn: task.lastDoneOn ?? null, lastDoneBy: task.lastDoneBy ?? null, lastDoneByName: task.lastDoneByName ?? null, lastDoneAt: task.lastDoneAt ?? null };
  const patch = {
    nextDueOn: action === 'snoozed' ? addDays(onDate, Math.max(1, snoozeDays)) : nextDue(task, care, onDate, settings.hemisphere),
    ...(action === 'done' ? { lastDoneOn: onDate, lastDoneBy: who.byUid, lastDoneByName: who.byName, lastDoneAt: now } : {}),
    updatedAt: now,
  };
  const event = {
    id, plantId: task.plantId, taskId, type: task.type, action, onDate,
    happenedAt: now, note: null, createdAt: now, ...who,
  };

  // Con casa y conexión: transacción en la nube; si otra persona se adelantó, gana la suya.
  if (session.remoteComplete && navigator.onLine) {
    try {
      const r = await session.remoteComplete(taskId, id, patch, event);
      if (r.already) {
        await db.put('events', r.event, { remote: true });
        return { task, event: r.event, already: true };
      }
      await db.tx(['tasks', 'events'], 'readwrite', ({ store }) => {
        store('events').put(event);
        store('tasks').put({ ...task, ...patch });
      }, { remote: true });
      return { task: { ...task, ...patch }, event, previous, already: false };
    } catch (err) {
      if (!/unavailable|network|offline/i.test(`${err.code} ${err.message}`)) throw err;
      // Sin red de verdad: sigue por el camino local; se sube al volver la conexión con el mismo id.
    }
  }

  return db.tx(['tasks', 'events'], 'readwrite', async ({ store, req }) => {
    const again = await req(store('events').get(id));
    if (again) return { task, event: again, already: true };
    store('events').put(event);
    const updated = { ...task, ...patch };
    store('tasks').put(updated);
    return { task: updated, event, previous, already: false };
  });
}

/** Deshace el evento de hoy y devuelve la tarea a como estaba. */
export async function undoTask(eventIdToUndo, previous) {
  return db.tx(['tasks', 'events'], 'readwrite', async ({ store, req }) => {
    const event = await req(store('events').get(eventIdToUndo));
    if (!event) return;
    store('events').delete(eventIdToUndo);
    const task = await req(store('tasks').get(event.taskId));
    if (task && previous) store('tasks').put({ ...task, ...previous, updatedAt: new Date().toISOString() });
  });
}

/** Todo lo necesario para pintar tareas: plantas activas, especies y tareas activas. */
export async function loadCareContext() {
  const [catalog, settings, plants, species, tasks] = await Promise.all([
    db.loadCatalog(), db.getSettings(), db.all('plants'), db.all('species'), db.all('tasks'),
  ]);
  const active = plants.filter((p) => !p.archivedAt);
  const plantById = new Map(active.map((p) => [p.id, p]));
  const speciesById = new Map(species.map((s) => [s.id, s]));
  const careOf = (plant) => db.resolveCare(catalog.kinds, speciesById.get(plant.speciesId), plant);
  return {
    catalog, settings, plants: active, plantById, speciesById, careOf,
    tasks: tasks.filter((t) => t.enabled && plantById.has(t.plantId)),
  };
}

/** Tareas vencidas o de hoy, más los eventos de hoy (para mostrar las hechas tachadas). */
export async function todayAgenda() {
  const ctx = await loadCareContext();
  const t0 = today();
  const events = (await db.all('events')).filter((e) => e.onDate === t0 && ctx.plantById.has(e.plantId));
  const doneToday = new Map(events.map((e) => [e.taskId, e]));
  const pending = ctx.tasks.filter((t) => t.nextDueOn <= t0 && !doneToday.has(t.id));
  const done = ctx.tasks.filter((t) => doneToday.has(t.id)).map((t) => ({ ...t, event: doneToday.get(t.id) }));
  pending.sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));
  return { ...ctx, pending, done };
}

/** Previsión día a día: { 'YYYY-MM-DD': [{ task, plant }] } para los próximos "days" días. Lo vencido cae hoy. */
export function forecast(ctx, days = 60, from = today()) {
  const end = addDays(from, days - 1);
  const out = {};
  for (const task of ctx.tasks) {
    const plant = ctx.plantById.get(task.plantId);
    const care = ctx.careOf(plant);
    let due = task.nextDueOn < from ? from : task.nextDueOn;
    for (let guard = 0; due <= end && guard < 400; guard++) {
      (out[due] ||= []).push({ task, plant });
      due = nextDue(task, care, due, ctx.settings.hemisphere);
    }
  }
  return out;
}
