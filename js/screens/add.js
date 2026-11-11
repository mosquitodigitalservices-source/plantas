// S07 Añadir planta: apodo, tipo (si no está en el catálogo), sitio y último riego. Crea las tareas sugeridas.
import * as db from '../db.js';
import { suggestTasks, saveTasks } from '../care.js';
import { speciesFromCandidate } from '../identify.js';
import { photoURL } from '../photos.js';
import { relativeDue } from '../dates.js';
import { html, icon, render, toast, go } from '../ui.js';
import { navbar } from './parts.js';
import { KIND_LABEL } from './result.js';

const LAST_WATERED = [['today', 'Hoy'], ['days', 'Hace unos días'], ['unknown', 'No lo sé']];

async function paint(view, query) {
  const catalog = await db.loadCatalog();
  const settings = await db.getSettings();
  const ident = query.ident ? await db.get('identifications', query.ident) : null;
  const photo = ident ? await db.get('photos', ident.photoIds[0]) : null;
  const candidate = ident?.candidates?.find((c) => c.scientificName === query.name) || null;
  const species = candidate?.matchedSpeciesId ? await db.get('species', candidate.matchedSpeciesId) : null;
  const sites = (await db.all('sites')).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const needsKind = !species;
  const suggested = candidate?.commonNames?.[0] || species?.commonNames?.es?.[0] || '';
  const back = ident ? `#/identificacion/${ident.id}` : '#/plantas';

  render(view, html`
    <div class="screen">
      ${navbar('Nueva planta', { back })}
      <div class="species-head">
        ${photo ? html`<img src="${photoURL(photo)}" alt="Tu foto">` : html`<div class="match__photo">${icon('leaf')}</div>`}
        <div>
          <p class="t-lg">${candidate ? suggested || candidate.scientificName : 'Sin identificar'}</p>
          ${candidate ? html`<p class="match__sci">${candidate.scientificName}</p>` : ''}
          ${candidate?.match === 'genus' ? html`<p class="t-xs t-muted">Con los cuidados de ${species.commonNames.es[0]}</p>` : ''}
        </div>
      </div>
      <form class="stack" novalidate>
        <label class="field"><span class="field__label">Apodo</span>
          <input class="input" name="nickname" maxlength="60" required autocomplete="off" value="${suggested}" aria-describedby="nick-err">
          <span class="field__error" id="nick-err" hidden>Ponle un nombre (hasta 60 caracteres).</span></label>

        ${needsKind ? html`
          <label class="field"><span class="field__label">Tipo de planta</span>
            <span class="field__hint">No está en el catálogo: con el tipo calculamos sus cuidados. Luego podrás ajustarlos.</span>
            <select class="input" name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${k === 'tropical' ? 'selected' : ''}>${l}</option>`)}</select></label>` : ''}

        <label class="field"><span class="field__label">Dónde está</span>
          <select class="input" name="site">
            <option value="">Sin indicar</option>
            ${sites.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
            <option value="__new">Otro sitio…</option>
          </select></label>
        <label class="field" data-newsite hidden><span class="field__label">Nombre del sitio</span>
          <input class="input" name="newSite" maxlength="60" placeholder="Salón, terraza, baño…"></label>

        <fieldset class="field" style="border: 0; padding: 0; margin: 0">
          <legend class="field__label" style="margin-bottom: var(--space-2)">¿Cuándo la regaste por última vez?</legend>
          <div class="choice">${LAST_WATERED.map(([k, l]) => html`<label><input type="radio" name="lastWatered" value="${k}" ${k === 'unknown' ? 'checked' : ''}>${l}</label>`)}</div>
        </fieldset>

        <button class="btn btn--primary btn--lg btn--block" type="submit">Añadir a mis plantas</button>
      </form>
    </div>`);

  const form = view.querySelector('form');
  form.site.addEventListener('change', () => { view.querySelector('[data-newsite]').hidden = form.site.value !== '__new'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = form.nickname.value.trim();
    const err = view.querySelector('#nick-err');
    if (!nickname) {
      err.hidden = false;
      form.nickname.setAttribute('aria-invalid', 'true');
      form.nickname.focus();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.setAttribute('aria-busy', 'true');
    try {
      let sp = species;
      const kind = form.kind?.value || species?.kind || 'other';
      if (!sp && candidate) sp = await speciesFromCandidate(candidate, kind);
      let siteId = form.site.value || null;
      if (siteId === '__new') {
        const name = form.newSite.value.trim();
        siteId = null;
        if (name) siteId = (await db.put('sites', { id: db.uid(), name, indoor: true, lightCategory: null })).id;
      }
      const plant = await db.put('plants', {
        id: db.uid(), speciesId: sp?.id || null, kind, siteId, nickname, potDiameterCm: null, hasDrainage: null,
        status: 'healthy', coverPhotoId: photo?.id || null, notes: '', careOverride: {}, acquiredOn: null, archivedAt: null,
      });
      if (photo) await db.put('photos', { ...photo, plantId: plant.id, purpose: 'cover' });
      if (ident) await db.put('identifications', { ...ident, chosenSpeciesId: sp?.id || null });
      const care = db.resolveCare(catalog.kinds, sp, plant);
      const tasks = suggestTasks(plant, care, settings.hemisphere, form.lastWatered.value);
      await saveTasks(tasks);
      const water = tasks.find((t) => t.type === 'water');
      toast(`${nickname} añadida. Riego: ${relativeDue(water.nextDueOn).toLowerCase()}.`);
      go(`/planta/${plant.id}`);
    } catch (error) {
      submit.removeAttribute('aria-busy');
      toast(error.message, { error: true });
    }
  });
}

export const render_ = (view, _params, query) => paint(view, query);
export { render_ as render };
