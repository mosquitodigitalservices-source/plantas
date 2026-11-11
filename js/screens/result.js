// S05 Resultado de identificación: candidatas con su coincidencia; elegir una lleva a S07.
import * as db from '../db.js';
import { runIdentification } from '../identify.js';
import { photoURL } from '../photos.js';
import { html, icon, render, toast, go } from '../ui.js';
import { navbar } from './parts.js';

const pct = (s) => `${Math.round(s * 100)} %`;
const KIND_LABEL = {
  tropical: 'Tropical de hoja', succulent: 'Suculenta', cactus: 'Cactus', fern: 'Helecho', herb: 'Aromática',
  orchid: 'Orquídea', palm: 'Palmera', flowering: 'De flor', other: 'Otra',
};
export { KIND_LABEL };

async function paint(view, id) {
  const ident = await db.get('identifications', id);
  if (!ident) {
    render(view, html`<div class="screen">${navbar('Resultado', { back: '#/camara' })}<p class="lead">No se encuentra esta identificación.</p></div>`);
    return;
  }
  const photo = await db.get('photos', ident.photoIds[0]);
  const species = new Map((await db.all('species')).map((s) => [s.id, s]));
  const photoTag = photo ? html`<img class="result-photo" src="${photoURL(photo, 'big')}" alt="Tu foto">` : '';

  let body;
  if (ident.status === 'pending' || ident.status === 'error') {
    const offline = ident.error?.code === 'offline' || ident.status === 'pending';
    body = html`
      <div class="notice ${offline ? 'notice--warning' : 'notice--danger'}" role="${offline ? 'status' : 'alert'}">${icon('alert')}
        <div class="notice__body"><p>${ident.error?.message || 'Todavía no se ha identificado.'}</p>
          <button class="btn btn--sm btn--secondary" data-action="retry">Reintentar</button></div></div>
      <a class="btn btn--ghost" href="#/anadir?ident=${ident.id}">Añadirla sin identificar</a>`;
  } else {
    const [best, ...rest] = ident.candidates;
    const row = (c, primary) => {
      const sp = c.matchedSpeciesId ? species.get(c.matchedSpeciesId) : null;
      const name = c.commonNames?.[0] || sp?.commonNames?.es?.[0] || c.scientificName;
      const note = c.match === 'genus' ? `Cuidados de ${sp.commonNames.es[0]} (mismo género)` : c.match === 'none' ? 'No está en el catálogo: elegirás su tipo' : 'En el catálogo';
      return html`
        <button class="card match ${primary ? 'match--primary' : ''}" data-pick="${c.scientificName}">
          <div class="match__photo">${icon('leaf')}</div>
          <div class="match__body">
            <p style="font-weight: 600">${name}</p>
            <p class="match__sci">${c.scientificName}</p>
            <div class="score"><span class="t-xs t-muted">${pct(c.score)} de coincidencia · ${note}</span>
              <div class="score__bar" aria-hidden="true"><span style="width: ${Math.max(2, Math.round(c.score * 100))}%"></span></div></div>
          </div>
          ${icon('chevron-right', 't-muted')}
        </button>`;
    };
    body = html`
      ${ident.demo ? html`<div class="notice notice--info" role="status">${icon('alert')}<div class="notice__body"><p><strong>Resultado de ejemplo.</strong> Sin clave de Pl@ntNet la app elige plantas del catálogo al azar, para poder probarla.</p></div></div>` : ''}
      ${best.score < 0.2 ? html`<p class="lead">No está nada claro. Prueba con otra foto más de cerca, de una hoja o una flor.</p>` : ''}
      <section class="stack">
        <h2 class="t-lg">¿Es esta?</h2>
        ${row(best, true)}
      </section>
      ${rest.length ? html`<section class="stack"><h2 class="t-lg">Otras posibilidades</h2>${rest.map((c) => row(c, false))}</section>` : ''}
      <div class="stack">
        <a class="btn btn--secondary" href="#/camara">${icon('camera', 'icon--sm')}Probar con otra foto</a>
        <a class="btn btn--ghost" href="#/anadir?ident=${ident.id}">Ninguna: añadirla sin identificar</a>
      </div>`;
  }

  render(view, html`
    <div class="screen">
      ${navbar('Resultado', { back: '#/camara' })}
      ${photoTag}
      ${body}
    </div>`);

  view.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    go(`/anadir?ident=${ident.id}&name=${encodeURIComponent(b.dataset.pick)}`);
  }));
  view.querySelector('[data-action="retry"]')?.addEventListener('click', async (e) => {
    e.target.setAttribute('aria-busy', 'true');
    try {
      await runIdentification(id);
    } catch (err) {
      toast(err.message, { error: true });
    }
    paint(view, id);
  });
}

export const render_ = (view, { id }) => paint(view, id);
export { render_ as render };
