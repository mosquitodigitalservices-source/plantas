// Pantallas que todavía no están construidas.
import { html, icon, render } from '../ui.js';
import { navbar } from './parts.js';

export function render_(view, { id, title, text }) {
  render(view, html`
    <div class="screen">
      ${navbar(title)}
      <div class="card empty">
        <div class="empty__art">${icon('leaf')}</div>
        <h2 class="t-lg">En construcción</h2>
        <p class="stub">${text}</p>
        <p class="footnote">${id}</p>
      </div>
    </div>`);
}

export { render_ as render };
