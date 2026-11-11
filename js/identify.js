// Identificación con la API gratuita de Pl@ntNet. La clave la escribe el usuario en Ajustes y solo vive en su iPhone.
import * as db from './db.js';

const ENDPOINT = 'https://my-api.plantnet.org/v2/identify/all';

export class IdentifyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 'no-key' | 'bad-key' | 'offline' | 'quota' | 'not-found' | 'server'
  }
}

async function callPlantNet(key, blobs, organs) {
  const form = new FormData();
  blobs.forEach((b, i) => {
    form.append('images', b, `foto-${i + 1}.jpg`);
    form.append('organs', organs[i] || 'auto');
  });
  const url = `${ENDPOINT}?api-key=${encodeURIComponent(key)}&lang=es&nb-results=5&include-related-images=false`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch {
    throw new IdentifyError('Sin conexión. La foto queda guardada para identificarla después.', 'offline');
  }
  if (res.status === 401 || res.status === 403) throw new IdentifyError(await explainRejection(res), 'bad-key');
  if (res.status === 404) throw new IdentifyError('Pl@ntNet no ha reconocido ninguna planta en la foto.', 'not-found');
  if (res.status === 429) throw new IdentifyError('Has gastado las identificaciones gratuitas de hoy. Vuelve a probar mañana.', 'quota');
  if (!res.ok) throw new IdentifyError(`Pl@ntNet ha fallado (${res.status}). Prueba otra vez en un rato.`, 'server');
  return res.json();
}

/** Busca la especie en el catálogo: primero por nombre científico, después por género. */
export function matchCatalog(scientificName, genus, catalogSpecies) {
  const name = scientificName.toLowerCase();
  const exact = catalogSpecies.find((s) => s.scientificName.toLowerCase() === name);
  if (exact) return { species: exact, match: 'species' };
  const byGenus = catalogSpecies.find((s) => s.genus.toLowerCase() === (genus || '').toLowerCase());
  if (byGenus) return { species: byGenus, match: 'genus' };
  return { species: null, match: 'none' };
}

/** Crea una especie del usuario a partir de un resultado sin coincidencia en el catálogo. */
export async function speciesFromCandidate(candidate, kind = 'other') {
  const existing = (await db.byIndex('species', 'scientificName', candidate.scientificName))[0];
  if (existing) return existing;
  const sp = db.normaliseSpecies({
    id: db.uid(), origin: 'user', scientificName: candidate.scientificName, genus: candidate.genus,
    family: candidate.family, kind, commonNames: { es: candidate.commonNames.slice(0, 3), en: [] }, care: {},
  });
  await db.put('species', sp);
  return sp;
}

/**
 * Identifica las fotos de una identificación ya guardada y actualiza su registro.
 * Sin clave, usa resultados de ejemplo del catálogo (marcados como demo) para poder probar la app.
 */
export async function runIdentification(identificationId) {
  const ident = await db.get('identifications', identificationId);
  const settings = await db.getSettings();
  await db.loadCatalog();
  const catalogSpecies = (await db.all('species')).filter((s) => s.origin === 'catalog');
  const photos = await Promise.all(ident.photoIds.map((id) => db.get('photos', id)));
  try {
    let candidates;
    let demo = false;
    if (!settings.plantnetKey) {
      demo = true;
      const pool = [...catalogSpecies].sort(() => Math.random() - 0.5).slice(0, 3);
      const scores = [0.78, 0.12, 0.04];
      candidates = pool.map((s, i) => ({
        scientificName: s.scientificName, genus: s.genus, family: null,
        commonNames: s.commonNames.es, score: scores[i],
      }));
    } else {
      const data = await callPlantNet(settings.plantnetKey, photos.map((p) => p.blob), ident.organs);
      candidates = (data.results || []).map((r) => ({
        scientificName: r.species.scientificNameWithoutAuthor,
        genus: r.species.genus?.scientificNameWithoutAuthor || r.species.scientificNameWithoutAuthor.split(' ')[0],
        family: r.species.family?.scientificNameWithoutAuthor || null,
        commonNames: r.species.commonNames || [],
        score: r.score,
      }));
      if (typeof data.remainingIdentificationRequests === 'number') {
        await db.saveSettings({ plantnetRemaining: data.remainingIdentificationRequests });
      }
    }
    for (const c of candidates) {
      const m = matchCatalog(c.scientificName, c.genus, catalogSpecies);
      c.matchedSpeciesId = m.species?.id || null;
      c.match = m.match;
    }
    if (!candidates.length) throw new IdentifyError('Pl@ntNet no ha reconocido ninguna planta en la foto.', 'not-found');
    return db.put('identifications', { ...ident, candidates, demo, status: 'done', error: null });
  } catch (err) {
    const status = err.code === 'offline' ? 'pending' : 'error';
    await db.put('identifications', { ...ident, status, error: { message: err.message, code: err.code || 'server' } });
    throw err;
  }
}

/** Explica un rechazo de Pl@ntNet según su mensaje (403 puede ser dominio no autorizado, no clave mala). */
export async function explainRejection(res) {
  let msg = '';
  try { msg = (await res.clone().json()).message || ''; } catch { /* sin cuerpo JSON */ }
  if (/origin not allowed/i.test(msg)) {
    return `Pl@ntNet no permite esta web. En my.plantnet.org > Settings > API key, escribe ${location.origin} en "Authorized domains" y pulsa "Update key settings".`;
  }
  if (/ip not allowed/i.test(msg)) {
    return 'Pl@ntNet solo acepta tu clave desde ciertas IP. En my.plantnet.org > Settings > API key, deja vacío "Authorized IPs" o activa "expose my API key" con tu dominio.';
  }
  if (res.status === 401) return 'Pl@ntNet dice que la clave no es válida. Cópiala otra vez con el botón de copiar de my.plantnet.org (ojo con la l minúscula y la I mayúscula).';
  return `Pl@ntNet ha rechazado la petición (${res.status}${msg ? `: ${msg}` : ''}).`;
}

/** Comprueba la clave con una petición ligera (no gasta identificaciones). */
export async function checkKey(key) {
  let res;
  try {
    res = await fetch(`https://my-api.plantnet.org/v2/projects?lang=es&api-key=${encodeURIComponent(key)}`);
  } catch {
    return { ok: false, message: 'No se pudo contactar con Pl@ntNet. ¿Tienes conexión? Si la tienes, revisa en my.plantnet.org que "expose my API key" está activado y que esta web está en "Authorized domains".' };
  }
  if (res.ok) return { ok: true };
  return { ok: false, message: await explainRejection(res) };
}
