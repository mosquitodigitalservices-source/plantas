// S12 Diagnóstico: marcar síntomas → problemas probables → empezar tratamiento.
import * as db from '../db.js';
import { loadProblems, rank } from '../diagnose.js';
import { savePhoto, photoURL } from '../photos.js';
import { html, icon, render, toast, go } from '../ui.js';
import { navbar } from './parts.js';

async function paint(view, query) {
  const data = await loadProblems();
  const problems = new Map(data.problems.map((p) => [p.id, p]));
  const symptomText = new Map(data.symptomGroups.flatMap((g) => g.symptoms.map((s) => [s.id, s.text])));
  const plants = (await db.all('plants')).filter((p) => !p.archivedAt).sort((a, b) => a.nickname.localeCompare(b.nickname, 'es'));
  let plantId = query.plant && plants.some((p) => p.id === query.plant) ? query.plant : '';
  let photo = null;
  let selected = new Set();
  const back = plantId ? `#/planta/${plantId}` : '#/';

  const askScreen = () => html`
    <div class="screen">
      ${navbar('¿Qué le pasa?', { back })}
      <p class="lead" style="margin-top: calc(var(--space-4) * -1)">Marca todo lo que veas. Cuantas más pistas, mejor.</p>
      ${plants.length ? html`
        <label class="field"><span class="field__label">Planta</span>
          <select class="input" name="plant"><option value="">Ninguna en concreto</option>
            ${plants.map((p) => html`<option value="${p.id}" ${p.id === plantId ? 'selected' : ''}>${p.nickname}</option>`)}</select></label>` : ''}
      <div class="gallery" style="grid-template-columns: 96px 1fr; align-items: center">
        <label class="gallery__add" aria-label="Añadir una foto del problema">${photo ? html`<img src="${photoURL(photo)}" alt="">` : icon('camera')}
          <input type="file" accept="image/*" capture="environment" data-input="photo"></label>
        <p class="t-sm t-muted">Foto opcional: se guarda en el historial para comparar cómo evoluciona.</p>
      </div>
      ${data.symptomGroups.map((g) => html`
        <fieldset class="card stack" style="border: 0; margin: 0">
          <legend class="t-lg" style="float: left; width: 100%; margin-bottom: var(--space-2)">${g.title}</legend>
          <div class="choice" style="clear: both">
            ${g.symptoms.map((s) => html`<label><input type="checkbox" name="symptom" value="${s.id}" ${selected.has(s.id) ? 'checked' : ''}>${s.text}</label>`)}
          </div>
        </fieldset>`)}
      <button class="btn btn--primary btn--lg btn--block" data-action="rank" ${selected.size ? '' : 'disabled'}>Ver qué puede ser</button>
    </div>`;

  const resultScreen = (ranked) => html`
    <div class="screen">
      ${navbar('Puede ser…', { back })}
      ${ranked.length ? ranked.map((r, i) => {
        const p = problems.get(r.problemId);
        return html`
          <section class="card stack ${i === 0 ? 'match--primary' : ''}">
            <div>
              <h2 class="t-lg">${p.name.es}</h2>
              <div class="score"><span class="t-xs t-muted">Encaja al ${Math.round(r.score * 100)} % con lo que has marcado</span>
                <div class="score__bar" aria-hidden="true"><span style="width: ${Math.round(r.score * 100)}%"></span></div></div>
            </div>
            <p class="t-sm">${p.description.es}</p>
            <p class="t-xs t-muted">Por: ${r.matched.map((s) => symptomText.get(s).toLowerCase()).join('; ')}.</p>
            <details class="collapse" style="box-shadow: none; background: var(--c-surface-sunken)"><summary>Qué hacer</summary>
              <div class="collapse__body"><ol style="margin: 0; padding-left: var(--space-5)">${p.treatment.es.map((t) => html`<li>${t}</li>`)}</ol>
              <p style="margin-top: var(--space-2)"><strong>Para que no vuelva:</strong> ${p.prevention.es}</p></div></details>
            ${plantId && p.id !== 'natural-aging' ? html`<button class="btn ${i === 0 ? 'btn--primary' : 'btn--secondary'}" data-start="${p.id}">Empezar este tratamiento</button>` : ''}
          </section>`;
      }) : html`
        <div class="notice notice--info" role="status">${icon('alert')}<div class="notice__body">
          <p>Lo que has marcado no encaja con ningún problema de la lista. Revisa el riego y la luz en la guía de la planta, o vuelve a mirar si hay bichos por el envés de las hojas.</p></div></div>`}
      ${!plantId && ranked.length ? html`<p class="lead">Elige una planta en el paso anterior para poder guardar el tratamiento.</p>` : ''}
      <div class="stack">
        <a class="btn btn--secondary btn--lg btn--block" href="${plantId ? `#/planta/${plantId}` : '#/'}" data-action="close">Cerrar</a>
        <button class="btn btn--ghost" data-action="again">Cambiar los síntomas</button>
      </div>
      <p class="footnote">Es una orientación según los síntomas, no un análisis. Si no mejora en dos o tres semanas, pregunta en un vivero.</p>
    </div>`;

  const showAsk = () => {
    render(view, askScreen());
    const form = view;
    const btn = view.querySelector('[data-action="rank"]');
    view.querySelector('[name="plant"]')?.addEventListener('change', (e) => { plantId = e.target.value; });
    view.querySelectorAll('[name="symptom"]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) selected.add(c.value); else selected.delete(c.value);
      btn.disabled = selected.size === 0;
    }));
    view.querySelector('[data-input="photo"]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        photo = await savePhoto(file, 'diagnose', plantId || null);
        showAsk();
      } catch (err) {
        toast(err.message, { error: true });
      }
    });
    btn.addEventListener('click', () => showResult());
    return form;
  };

  const showResult = async () => {
    const ranked = rank(data.problems, [...selected]);
    const diagnosis = await db.put('diagnoses', {
      id: db.uid(), plantId: plantId || null, photoId: photo?.id || null,
      answers: Object.fromEntries([...selected].map((s) => [s, true])), ranked: ranked.map(({ problemId, score }) => ({ problemId, score })),
    });
    if (photo && plantId && !photo.plantId) await db.put('photos', { ...photo, plantId });
    render(view, resultScreen(ranked));
    window.scrollTo(0, 0);
    view.querySelector('[data-action="again"]').addEventListener('click', showAsk);
    view.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', async () => {
      const p = problems.get(b.dataset.start);
      const open = (await db.byIndex('treatments', 'plantId', plantId)).filter((t) => !t.finishedAt);
      for (const t of open) await db.put('treatments', { ...t, finishedAt: new Date().toISOString() });
      await db.put('treatments', {
        id: db.uid(), plantId, diagnosisId: diagnosis.id, problemId: p.id,
        steps: p.treatment.es.map((text) => ({ text, done: false })), startedAt: new Date().toISOString(), finishedAt: null,
      });
      const plant = await db.get('plants', plantId);
      await db.put('plants', { ...plant, status: 'treating' });
      toast(`Tratamiento empezado: ${p.name.es.toLowerCase()}`);
      go(`/planta/${plantId}`);
    }));
  };

  showAsk();
}

export const render_ = (view, _params, query) => paint(view, query);
export { render_ as render };
