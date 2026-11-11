// Diagnóstico por síntomas, sin conexión: puntúa cada problema según los síntomas marcados.
import * as db from './db.js';

let cache;

/** Carga data/problems.json y guarda los problemas en IndexedDB si la versión es nueva. */
export async function loadProblems() {
  if (cache) return cache;
  const res = await fetch(new URL('../data/problems.json', import.meta.url));
  if (!res.ok) throw new Error('No se pudo cargar la lista de problemas');
  const data = await res.json();
  const settings = await db.getSettings();
  if (settings.problemsVersion !== data.version) {
    await db.tx(['problems'], 'readwrite', ({ store }) => { for (const p of data.problems) store('problems').put(p); });
    await db.saveSettings({ problemsVersion: data.version });
  }
  cache = data;
  return data;
}

/**
 * Puntúa los problemas. coverage: cuánto de lo típico del problema has marcado (sobre sus 3 síntomas
 * más fuertes). precision: qué parte de lo marcado encaja con el problema.
 */
export function rank(problems, selected, { limit = 3, min = 0.3 } = {}) {
  const sel = new Set(selected);
  if (!sel.size) return [];
  const out = [];
  for (const p of problems) {
    const entries = Object.entries(p.weights);
    const matched = entries.filter(([s]) => sel.has(s));
    if (!matched.length) continue;
    const top = entries.map(([, w]) => w).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    const coverage = Math.min(1, matched.reduce((a, [, w]) => a + w, 0) / top);
    const precision = matched.length / sel.size;
    const score = Math.round((coverage * 0.7 + precision * 0.3) * 100) / 100;
    if (score >= min) out.push({ problemId: p.id, score, matched: matched.map(([s]) => s) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
