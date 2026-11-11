// Arranque y navegación por hash. Cada pantalla exporta render(view, params, query).
import * as db from './db.js';
import { todayAgenda } from './care.js';
import { render, html, toast } from './ui.js';
import { onSession } from './session.js';

const routes = [
  ['/', 'home', () => import('./screens/home.js')],
  ['/plantas', 'plants', () => import('./screens/plants.js')],
  ['/planta/:id', 'plants', () => import('./screens/plant.js')],
  ['/camara', 'camera', () => import('./screens/camera.js')],
  ['/identificacion/:id', 'camera', () => import('./screens/result.js')],
  ['/anadir', 'camera', () => import('./screens/add.js')],
  ['/calendario', 'calendar', () => import('./screens/calendar.js')],
  ['/ajustes', 'settings', () => import('./screens/settings.js')],
  ['/cuenta', 'settings', () => import('./screens/account.js')],
  ['/especie/:id', 'plants', () => import('./screens/species.js')],
  ['/tarea/:id', 'plants', () => import('./screens/task.js')],
  ['/diagnostico', 'camera', () => import('./screens/diagnose.js')],
  ['/luz', 'camera', () => import('./screens/light.js')],
  ['/sitio', 'plants', () => import('./screens/stub.js'), { id: 'S14', title: 'Recomendación de sitio', text: 'Llega con los should-haves.' }],
  ['/buscar', 'plants', () => import('./screens/stub.js'), { id: 'S17', title: 'Buscar plantas', text: 'Llega con los should-haves.' }],
  ['/bienvenida', 'home', () => import('./screens/stub.js'), { id: 'S01', title: 'Bienvenida', text: 'Llega con los should-haves.' }],
];

function match(path) {
  for (const [pattern, tab, load, extra] of routes) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    const m = path.match(re);
    if (m) return { tab, load, extra, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const view = document.getElementById('view');
let navToken = 0;

async function navigate(e) {
  const keepScroll = e?.keepScroll === true;
  const scrollY = window.scrollY;
  const token = ++navToken;
  const [path, qs = ''] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const route = match(path);
  document.querySelectorAll('.tab').forEach((t) => t.toggleAttribute('aria-current', false));
  if (!route) {
    render(view, html`<div class="screen"><header class="navbar"><h1 class="navbar__title navbar__title--large">No existe</h1></header><p class="lead">Esta pantalla no existe. <a href="#/">Volver a Hoy</a>.</p></div>`);
    return;
  }
  document.querySelector(`.tab[data-tab="${route.tab}"]`)?.setAttribute('aria-current', 'page');
  try {
    const mod = await route.load();
    if (token !== navToken) return;
    await mod.render(view, { ...route.params, ...route.extra }, query);
    if (token !== navToken) return;
    window.scrollTo(0, keepScroll ? scrollY : 0);
    document.title = `${view.querySelector('h1')?.textContent || 'Plantas'} · Plantas`;
  } catch (err) {
    console.error(err);
    render(view, html`<div class="screen"><header class="navbar"><h1 class="navbar__title navbar__title--large">Algo ha fallado</h1></header>
      <div class="notice notice--danger" role="alert"><div class="notice__body"><p>${err.message}</p><a class="btn btn--sm btn--secondary" href="#/">Volver a Hoy</a></div></div></div>`);
  }
  updateBadge();
}

export async function updateBadge() {
  try {
    const { pending } = await todayAgenda();
    const badge = document.getElementById('badge');
    badge.hidden = pending.length === 0;
    badge.textContent = pending.length;
    badge.setAttribute('aria-label', `${pending.length} tareas pendientes hoy`);
  } catch { /* el globo no es crítico */ }
}

window.addEventListener('hashchange', navigate);

// Cambios que llegan de la casa: se repinta la pantalla actual, salvo que estés escribiendo en ella.
// Hoy y Ajustes enseñan el estado de la cuenta: se repintan cuando cambia la sesión.
onSession(() => {
  const h = location.hash || '#/';
  if (h.startsWith('#/ajustes') || h === '#/' || h === '#') window.dispatchEvent(new CustomEvent('plantas:remote-change'));
});

// Solo se repintan solas las pantallas de consulta. Las de formulario o con un resultado en pantalla
// (diagnóstico, añadir, recordatorio, luz, cámara, cuenta…) no: perderían lo que el usuario está haciendo.
const LIVE_SCREENS = [/^#?\/?$/, /^#\/plantas$/, /^#\/planta\/[^/?]+$/, /^#\/calendario$/, /^#\/ajustes$/];

window.addEventListener('plantas:remote-change', () => {
  const h = (location.hash || '#/').split('?')[0];
  if (!LIVE_SCREENS.some((re) => re.test(h))) { updateBadge(); return; }
  const a = document.activeElement;
  if (a && view.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
  if (document.querySelector('dialog[open]')) return;
  navigate({ keepScroll: true });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateBadge(); });

/** Errores del arranque, con el paso en que ocurrieron (se ven en Ajustes → Diagnóstico). */
export const startupErrors = [];

async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(label, err);
    startupErrors.push({ label, name: err?.name || 'Error', message: err?.message || String(err), at: new Date().toISOString() });
  }
}

(async () => {
  // Cada paso por separado: si uno falla, los demás siguen.
  await step('abrir la base de datos', () => db.open());
  await step('cargar el catálogo de plantas', () => db.loadCatalog());
  await step('cargar la lista de problemas', async () => (await import('./diagnose.js')).loadProblems());
  // Pedir que iOS no borre los datos (suele concederlo a las apps de la pantalla de inicio).
  await step('pedir almacenamiento persistente', async () => { await navigator.storage?.persist?.(); });
  if (startupErrors.length) {
    const e = startupErrors[0];
    toast(`No se pudo ${e.label} (${e.name}). Detalles en Ajustes → Diagnóstico.`, { error: true, duration: 9000 });
  }
  navigate();
  // Cuentas y casa compartida: si no carga (sin red), la app sigue en local.
  import('./sync.js').then((m) => m.start()).catch(() => {});
  // Sin conexión: solo fuera de localhost, para que al desarrollar siempre se vea el código nuevo.
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
