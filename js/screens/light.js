// S13 Medidor de luz y S14 (recomendación de sitio para la planta elegida).
import * as db from '../db.js';
import { readExposure, luxFromExposure, category, fit, scalePos, CATEGORY_LUX } from '../light.js';
import { html, icon, render, toast } from '../ui.js';
import { navbar } from './parts.js';
import { LIGHT_TEXT } from './species.js';

const FIT_TEXT = {
  good: (n) => `Buena luz para ${n}.`,
  'too-dark': (n) => `Poca luz para ${n}: acércala a una ventana.`,
  'too-bright': (n) => `Demasiada luz para ${n}: apártala del sol directo o pon una cortina.`,
};

async function paint(view, query) {
  const [catalog, settings] = await Promise.all([db.loadCatalog(), db.getSettings()]);
  const plants = (await db.all('plants')).filter((p) => !p.archivedAt).sort((a, b) => a.nickname.localeCompare(b.nickname, 'es'));
  let plantId = query.plant && plants.some((p) => p.id === query.plant) ? query.plant : '';
  let reading = null; // { lux, cat, method, exif }
  const back = plantId ? `#/planta/${plantId}` : '#/';

  const needOf = async (id) => {
    const plant = plants.find((p) => p.id === id);
    if (!plant) return null;
    const sp = plant.speciesId ? await db.get('species', plant.speciesId) : null;
    return { plant, need: db.resolveCare(catalog.kinds, sp, plant).lightNeed };
  };

  const draw = async () => {
    const target = plantId ? await needOf(plantId) : null;
    const verdict = reading && target ? fit(target.need, reading.cat) : null;
    render(view, html`
      <div class="screen">
        ${navbar('Medidor de luz', { back })}
        ${plants.length ? html`<label class="field"><span class="field__label">Para qué planta</span>
          <select class="input" name="plant"><option value="">Ninguna en concreto</option>
            ${plants.map((p) => html`<option value="${p.id}" ${p.id === plantId ? 'selected' : ''}>${p.nickname}</option>`)}</select></label>` : ''}
        ${target ? html`<p class="t-sm t-muted">${target.plant.nickname} necesita <strong>${LIGHT_TEXT[target.need][0].toLowerCase()}</strong>.</p>` : ''}

        <div class="card lightmeter">
          ${reading ? html`
            <p class="lightmeter__value">${reading.lux.toLocaleString('es-ES')} <span class="t-lg t-muted">lux${reading.method === 'manual' ? ' aprox.' : ''}</span></p>
            <p class="t-sm">${LIGHT_TEXT[reading.cat][0]}</p>
            <div class="lightmeter__track" role="meter" aria-valuemin="0" aria-valuemax="25000" aria-valuenow="${reading.lux}" aria-valuetext="${reading.lux} lux, ${LIGHT_TEXT[reading.cat][0].toLowerCase()}"><span class="lightmeter__dot" style="left: ${scalePos(reading.lux)}%"></span></div>
            <div class="lightmeter__scale"><span>Sombra</span><span>Indirecta</span><span>Directa</span></div>`
          : html`<p class="t-lg">Pon el móvil donde está la planta</p>
            <p class="t-sm t-muted">Con la cámara de atrás mirando hacia la ventana, de donde viene la luz. Mejor a mediodía, sin luces encendidas.</p>`}
          <label class="btn btn--primary btn--lg btn--block" style="position: relative">${icon('camera', 'icon--sm')}${reading ? 'Medir de nuevo' : 'Medir'}
            <input type="file" accept="image/*" capture="environment" data-input="measure" class="sr-only"></label>
        </div>

        ${verdict ? html`<div class="notice ${verdict === 'good' ? 'notice--info' : 'notice--warning'}" role="status">${icon(verdict === 'good' ? 'check' : 'sun')}
          <div class="notice__body"><p>${FIT_TEXT[verdict](target.plant.nickname)}</p></div></div>` : ''}
        ${reading && plantId ? html`<button class="btn btn--secondary" data-action="save">Guardar la medida en ${plants.find((p) => p.id === plantId).nickname}</button>` : ''}

        <details class="collapse"><summary>${icon('sun')}¿No funciona la medida?</summary>
          <div class="collapse__body stack">
            <p>Si la foto no trae los datos de exposición, elige a ojo cómo es ese sitio:</p>
            <div class="stack">${['shade', 'indirect', 'direct'].map((c) => html`<button class="btn btn--secondary" data-manual="${c}">${LIGHT_TEXT[c][0]}</button>`)}</div>
          </div></details>
        <p class="footnote">La medida es una estimación a partir de la exposición de la cámara. Varía con la hora y las nubes: compara sitios a la misma hora.</p>
      </div>`);

    view.querySelector('[name="plant"]')?.addEventListener('change', (e) => { plantId = e.target.value; draw(); });
    view.querySelector('[data-input="measure"]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const exif = readExposure(await file.arrayBuffer());
      const lux = exif ? luxFromExposure(exif, settings.luxCalibration || 1) : null;
      if (lux == null) {
        toast('Esta foto no trae los datos de exposición. Elige a ojo en "¿No funciona la medida?".', { error: true, duration: 7000 });
        view.querySelector('details.collapse').open = true;
        return;
      }
      reading = { lux, cat: category(lux), method: 'exif', exif };
      draw();
    });
    view.querySelectorAll('[data-manual]').forEach((b) => b.addEventListener('click', () => {
      const cat = b.dataset.manual;
      reading = { lux: CATEGORY_LUX[cat], cat, method: 'manual', exif: null };
      draw();
    }));
    view.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      const plant = plants.find((p) => p.id === plantId);
      await db.put('light_readings', {
        id: db.uid(), plantId, siteId: plant.siteId || null, lux: reading.lux, category: reading.cat,
        exif: reading.exif, method: reading.method, measuredAt: new Date().toISOString(),
      });
      if (plant.siteId) {
        const site = await db.get('sites', plant.siteId);
        if (site) await db.put('sites', { ...site, lightCategory: reading.cat });
      }
      toast('Medida guardada');
    });
  };

  draw();
}

export const render_ = (view, _params, query) => paint(view, query);
export { render_ as render };
