// Utilidades de interfaz: plantillas con escapado, iconos, toasts y hojas.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Marca un trozo de HTML como seguro para que html`` no lo escape. */
export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(s);

/** Plantilla: escapa los valores salvo que sean Safe (o listas de Safe). null/undefined no pintan nada; true/false se pintan tal cual (para aria-*). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.s : esc(x))).join('') : v instanceof Safe ? v.s : v == null ? '' : esc(v);
    out += part + strings[i + 1];
  });
  return new Safe(out);
}

const ICONS = new URL('../icons/icons.svg', import.meta.url).pathname;
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" aria-hidden="true"><use href="${ICONS}#${name}"/></svg>`);

export function render(el, safe) {
  el.innerHTML = safe instanceof Safe ? safe.s : String(safe);
}

// ------------------------------------------------------------- toast
let toastTimer;
export function toast(text, { action, onAction, error = false, duration = 4000 } = {}) {
  const region = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' toast--error' : ''}`;
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn--ghost btn--sm';
    b.textContent = action;
    b.addEventListener('click', () => { el.remove(); onAction?.(); });
    el.append(b);
  }
  region.replaceChildren(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), duration);
}

// ------------------------------------------------------------- hoja de confirmación
/** Abre una hoja inferior con acciones. Devuelve la clave de la acción elegida o null. */
export function sheet({ title, text, actions }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.setAttribute('aria-labelledby', 'sheet-title');
    render(d, html`
      <div class="sheet__grabber"></div>
      <h2 class="t-lg" id="sheet-title">${title}</h2>
      ${text ? html`<p class="t-muted" style="margin-top: var(--space-2)">${text}</p>` : ''}
      <div class="sheet__actions">
        ${actions.map((a) => html`<button class="btn btn--block ${a.kind === 'ghost' ? '' : 'btn--lg'} btn--${a.kind || 'secondary'}" data-key="${a.key}">${a.label}</button>`)}
      </div>`);
    let result = null;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (b) { result = b.dataset.key; d.close(); }
      else if (e.target === d) d.close();
    });
    d.addEventListener('close', () => { d.remove(); resolve(result === 'cancel' ? null : result); });
    document.body.append(d);
    d.showModal();
  });
}

/** Navegación con hash: go('/planta/123'). */
export const go = (path) => { location.hash = `#${path}`; };

export function emptyState({ iconName, title, text, action }) {
  return html`
    <div class="card empty">
      <div class="empty__art">${icon(iconName)}</div>
      <h2 class="t-lg">${title}</h2>
      <p>${text}</p>
      ${action || ''}
    </div>`;
}
