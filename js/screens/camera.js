// S04 Identificar: un botón de cámara grande, protagonista de la pantalla; galería y tipo de foto debajo.
import * as db from '../db.js';
import { savePhoto } from '../photos.js';
import { runIdentification } from '../identify.js';
import { html, icon, render, toast, go } from '../ui.js';
import { navbar } from './parts.js';

const ORGANS = [['auto', 'Automático'], ['leaf', 'Hoja'], ['flower', 'Flor'], ['fruit', 'Fruto']];

export async function handleFile(file, organ = 'auto') {
  const photo = await savePhoto(file, 'identify');
  const ident = await db.put('identifications', {
    id: db.uid(), photoIds: [photo.id], provider: 'plantnet', organs: [organ],
    candidates: [], chosenSpeciesId: null, status: 'pending', demo: false,
  });
  try {
    await runIdentification(ident.id);
  } catch (err) {
    if (err.code !== 'offline') toast(err.message, { error: true, duration: 6000 });
    else toast(err.message, { duration: 6000 });
  }
  return ident.id;
}

export async function renderCamera(v) {
  const s = await db.getSettings();
  let organ = 'auto';

  render(v, html`
    <div class="screen">
      ${navbar('Identificar')}
      ${!s.plantnetKey ? html`
        <div class="notice notice--info" role="status">${icon('alert')}
          <div class="notice__body"><p>Falta la clave gratuita de Pl@ntNet. Mientras tanto, los resultados son <strong>de ejemplo</strong>.</p>
          <a class="btn btn--sm btn--secondary" href="#/ajustes">Añadir clave</a></div></div>` : ''}

      <section class="shoot" id="vf">
        <label class="shoot__button">
          <span class="shoot__ring" aria-hidden="true">${icon('camera', 'shoot__icon')}</span>
          <span class="shoot__title">Hacer una foto</span>
          <span class="shoot__subtitle">Abre la cámara</span>
          <input type="file" accept="image/*" capture="environment" data-input="camera" class="sr-only">
        </label>
        <p class="shoot__busy" aria-live="polite" hidden>Identificando…</p>
        <label class="btn btn--ghost shoot__gallery">${icon('image', 'icon--sm')}Elegir de la galería
          <input type="file" accept="image/*" data-input="gallery" class="sr-only"></label>
      </section>

      <section class="stack">
        <div class="segmented" role="group" aria-label="Qué sale en la foto">
          ${ORGANS.map(([k, label]) => html`<button aria-pressed="${k === organ}" data-organ="${k}">${label}</button>`)}
        </div>
        <ul class="capture__tips">
          <li>Una sola planta por foto, que ocupe casi todo el encuadre.</li>
          <li>Mejor una hoja o una flor de cerca que la maceta entera.</li>
          <li>Con luz de día y sin contraluz.</li>
        </ul>
      </section>
    </div>`);

  const shoot = v.querySelector('#vf');
  const busyText = v.querySelector('.shoot__busy');

  v.querySelector('.segmented').addEventListener('click', (e) => {
    const b = e.target.closest('[data-organ]');
    if (!b) return;
    organ = b.dataset.organ;
    v.querySelectorAll('[data-organ]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  v.querySelectorAll('input[type="file"]').forEach((input) => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    shoot.classList.add('shoot--busy');
    shoot.setAttribute('aria-busy', 'true');
    busyText.hidden = false;
    try {
      const id = await handleFile(file, organ);
      go(`/identificacion/${id}`);
    } catch (err) {
      shoot.classList.remove('shoot--busy');
      shoot.removeAttribute('aria-busy');
      busyText.hidden = true;
      toast(err.message, { error: true });
    }
  }));
}

export { renderCamera as render };
