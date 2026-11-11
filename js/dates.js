// Fechas locales "YYYY-MM-DD" sin hora: el horario de verano no las mueve.

const pad = (n) => String(n).padStart(2, '0');

export function toLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = () => toLocalDate(new Date());

export function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // mediodía: a salvo de cambios de hora
}

export function addDays(s, n) {
  const d = parseLocal(s);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}

export function diffDays(a, b) {
  return Math.round((parseLocal(a) - parseLocal(b)) / 86400000);
}

/** Mes 1–12 de una fecha local, pasado al hemisferio norte (en el sur se desplaza 6 meses). */
export function northMonth(s, hemisphere) {
  const m = parseLocal(s).getMonth() + 1;
  return hemisphere === 'south' ? ((m + 5) % 12) + 1 : m;
}

/** Temporada cálida = abril a septiembre en el hemisferio norte. */
export function isWarm(s, hemisphere) {
  const m = northMonth(s, hemisphere);
  return m >= 4 && m <= 9;
}

const fmtDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const fmtShortYear = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export function relativeDue(s, ref = today()) {
  const d = diffDays(s, ref);
  if (d < -1) return `Vencida hace ${-d} días`;
  if (d === -1) return 'Vencida desde ayer';
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  if (d < 7) return `En ${d} días`;
  const date = parseLocal(s);
  return date.getFullYear() === parseLocal(ref).getFullYear() ? fmtShort.format(date) : fmtShortYear.format(date);
}

export const longDay = (s) => fmtDay.format(parseLocal(s));
