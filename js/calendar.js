// Recordatorios en el Calendario de iOS: un .ics con un evento y una alarma por cada día con tareas.
import * as db from './db.js';
import { forecast, loadCareContext, taskLabel } from './care.js';
import { addDays, today } from './dates.js';

export const CALENDAR_DAYS = 60;

const icsDate = (s) => s.replaceAll('-', '');
const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Líneas de más de 75 octetos se pliegan (RFC 5545). */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** "Regar Potus y Monstera · Abonar Potus" */
export function summarise(items) {
  const byType = new Map();
  for (const { task, plant } of items) {
    const label = taskLabel(task);
    if (!byType.has(label)) byType.set(label, []);
    byType.get(label).push(plant.nickname);
  }
  const list = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`);
  return [...byType].map(([label, names]) => `${label} ${list(names)}`).join(' · ');
}

/** Firma de la previsión a partir de "from": { fecha: 'idTarea,idTarea' }. */
export function signature(days, from, until) {
  const sig = {};
  for (const [date, items] of Object.entries(days)) {
    if (date < from || date > until) continue;
    sig[date] = items.map((i) => i.task.id).sort().join(',');
  }
  return sig;
}

export async function buildICS() {
  const ctx = await loadCareContext();
  const from = today();
  const until = addDays(from, CALENDAR_DAYS - 1);
  const days = forecast(ctx, CALENDAR_DAYS, from);
  const [hh, mm] = ctx.settings.digestTime.split(':');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plantas//Recordatorios//ES', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Plantas',
  ];
  for (const date of Object.keys(days).sort()) {
    const text = summarise(days[date]);
    // Hora "flotante" (sin Z): la alarma suena a esa hora local aunque cambie el horario de verano.
    const start = `${icsDate(date)}T${hh}${mm}00`;
    const endMinutes = Number(mm) + 15;
    const end = `${icsDate(date)}T${String(Number(hh) + Math.floor(endMinutes / 60)).padStart(2, '0')}${String(endMinutes % 60).padStart(2, '0')}00`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:plantas-${icsDate(date)}@plantas.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeText(`🌿 ${text}`)}`,
      `DESCRIPTION:${escapeText('Abre la app Plantas para marcar lo que hagas.')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(text)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return {
    ics: lines.map(fold).join('\r\n') + '\r\n',
    eventCount: Object.keys(days).length,
    until,
    signature: signature(days, from, until),
  };
}

/** Descarga el .ics y guarda qué se exportó, para saber luego si está desactualizado. */
export async function exportCalendar() {
  const { ics, eventCount, until, signature: sig } = await buildICS();
  const file = new File([ics], 'plantas.ics', { type: 'text/calendar' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantas.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  await db.saveSettings({ calendarExportedAt: new Date().toISOString(), calendarUntil: until, calendarSignature: sig });
  return { eventCount, until };
}

/**
 * Estado del calendario exportado:
 * 'never' | 'stale' (las tareas ya no coinciden) | 'ending' (quedan 7 días o menos) | 'ok'
 */
export async function calendarStatus() {
  const ctx = await loadCareContext();
  const { calendarUntil, calendarSignature } = ctx.settings;
  if (!calendarUntil || !calendarSignature) return { state: ctx.tasks.length ? 'never' : 'ok' };
  const from = today();
  if (calendarUntil < from) return { state: 'stale', reason: 'expired' };
  // Se compara desde mañana: lo de hoy ya está avisado, y marcarlo como hecho no debe dar el calendario por viejo.
  const tomorrow = addDays(from, 1);
  const now = signature(forecast(ctx, CALENDAR_DAYS, from), tomorrow, calendarUntil);
  const before = Object.fromEntries(Object.entries(calendarSignature).filter(([d]) => d >= tomorrow));
  const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
  for (const k of keys) if (now[k] !== before[k]) return { state: 'stale', reason: 'changed' };
  if (calendarUntil <= addDays(from, 7)) return { state: 'ending', until: calendarUntil };
  return { state: 'ok', until: calendarUntil };
}
