// S06 Guía de cuidado de una especie. Los textos se escriben a partir de los valores del catálogo.
import * as db from '../db.js';
import { html, icon, render } from '../ui.js';
import { navbar } from './parts.js';
import { KIND_LABEL } from './result.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const LIGHT_TEXT = {
  shade: ['Poca luz', 'Aguanta rincones sin sol y lejos de la ventana. Con algo más de luz crece más rápido, pero el sol directo le quema las hojas.'],
  indirect: ['Luz indirecta', 'Mucha claridad sin sol directo en las horas centrales: cerca de una ventana con cortina o a un par de metros de ella.'],
  direct: ['Luz directa', 'Necesita varias horas de sol al día. Junto a una ventana orientada al sur o al oeste, o en el exterior.'],
};
const HUMIDITY = { low: 'Prefiere el aire seco; no hace falta pulverizarla.', medium: 'Humedad normal de una casa.', high: 'Le gusta la humedad: pulverízala o ponla cerca de otras plantas, lejos de radiadores.' };

/** Meses de crecimiento (del norte) pasados al hemisferio del usuario y escritos como rango. */
export function monthsText(months, hemisphere) {
  if (!months?.length) return null;
  const shifted = months.map((m) => (hemisphere === 'south' ? ((m + 5) % 12) + 1 : m)).sort((a, b) => a - b);
  return `de ${MONTHS[shifted[0] - 1]} a ${MONTHS[shifted.at(-1) - 1]}`;
}

const everyMonths = (m) => (m <= 12 ? 'cada año' : m % 12 === 0 ? `cada ${m / 12} años` : `cada ${m} meses`);

export function guideSections(care, species, hemisphere) {
  const growth = monthsText(care.fertilizeMonths, hemisphere);
  return [
    ['water', 'Riego', `Cada ${care.waterDaysWarm} días en primavera y verano, y cada ${care.waterDaysCold} en otoño e invierno, como punto de partida. Antes de regar, mete un dedo en la tierra: si los primeros centímetros siguen húmedos, espera un par de días. Mejor quedarse corto que encharcarla.`],
    ['sun', LIGHT_TEXT[care.lightNeed][0], LIGHT_TEXT[care.lightNeed][1]],
    ['alert', 'Temperatura y humedad', `Entre ${care.tempMinC} y ${care.tempMaxC} °C. ${HUMIDITY[care.humidity] || ''}`],
    ['repot', 'Tierra y maceta', `${care.soil}. Trasplántala ${everyMonths(care.repotMonths)} más o menos, o cuando las raíces salgan por debajo, siempre a una maceta con agujeros.`],
    ['fertilize', 'Abono', care.fertilizeDays ? `Cada ${care.fertilizeDays} días ${growth ? `${growth}, cuando está creciendo` : ''}. El resto del año, nada.` : 'No necesita abono.'],
    ...(species?.toxicPets != null ? [['alert', 'Mascotas', species.toxicPets ? 'Es tóxica si la muerden gatos o perros. Ponla donde no lleguen.' : 'No se considera tóxica para gatos ni perros.']] : []),
  ];
}

async function paint(view, id, back) {
  back = back && back.startsWith('#/') ? back : null;
  const [catalog, settings, species] = await Promise.all([db.loadCatalog(), db.getSettings(), db.get('species', id)]);
  if (!species) {
    render(view, html`<div class="screen">${navbar('Guía de cuidado', { back: '#/plantas' })}<p class="lead">No se encuentra esta especie.</p></div>`);
    return;
  }
  const care = db.resolveCare(catalog.kinds, species, null);
  const names = species.commonNames?.es || [];
  render(view, html`
    <div class="screen">
      ${navbar(db.displayName(species), { back: back || '#/plantas' })}
      <div>
        <p class="match__sci">${species.scientificName}</p>
        ${names.length > 1 ? html`<p class="t-sm t-muted">También: ${names.slice(1).join(', ')}</p>` : ''}
        <div class="chip-row" style="margin-top: var(--space-3)">
          <span class="chip">${KIND_LABEL[species.kind] || 'Planta'}</span>
          <span class="chip chip--accent">${icon('sun')}${LIGHT_TEXT[care.lightNeed][0]}</span>
          <span class="chip chip--water">${icon('water')}Cada ${care.waterDaysWarm}–${care.waterDaysCold} días</span>
        </div>
      </div>
      <div>
        ${guideSections(care, species, settings.hemisphere).map(([ic, title, text], i) => html`
          <details class="collapse" ${i < 2 ? 'open' : ''}><summary>${icon(ic)}${title}</summary><div class="collapse__body">${text}</div></details>`)}
      </div>
      <p class="footnote">Valores orientativos del catálogo de la app${species.origin === 'user' ? ', calculados por el tipo de planta' : ''}. Cada casa es distinta: ajústalos en cada planta si ves que no encajan.</p>
    </div>`);
}

export const render_ = (view, { id }, query) => paint(view, id, query.back);
export { render_ as render };
