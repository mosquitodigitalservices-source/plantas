// Medidor de luz: estima los lux a partir de la exposición que guarda la cámara en el EXIF de la foto.

const TAGS = { 0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8827: 'ISO', 0x9203: 'BrightnessValue' };

/** Lee ExposureTime, FNumber, ISO y BrightnessValue de un JPEG. Devuelve null si no hay EXIF. */
export function readExposure(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    off += 2 + size;
  }
  return null;
}

function parseTiff(v, start) {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, little);
  const u32 = (o) => v.getUint32(start + o, little);
  const s32 = (o) => v.getInt32(start + o, little);
  const out = {};
  const readIfd = (ifd, wantExifPointer) => {
    if (start + ifd + 2 > v.byteLength) return null;
    const n = u16(ifd);
    let exifPtr = null;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (start + e + 12 > v.byteLength) break;
      const tag = u16(e);
      const type = u16(e + 2);
      if (wantExifPointer && tag === 0x8769) exifPtr = u32(e + 8);
      const name = TAGS[tag];
      if (!name) continue;
      if (type === 3) out[name] = u16(e + 8);                       // SHORT
      else if (type === 4) out[name] = u32(e + 8);                  // LONG
      else if (type === 5 || type === 10) {                         // RATIONAL / SRATIONAL
        const p = u32(e + 8);
        const num = type === 5 ? u32(p) : s32(p);
        const den = type === 5 ? u32(p + 4) : s32(p + 4);
        if (den) out[name] = num / den;
      }
    }
    return exifPtr;
  };
  const exifPtr = readIfd(u32(4), true);
  if (exifPtr) readIfd(exifPtr, false);
  return Object.keys(out).length ? out : null;
}

/** EV100 = log2(N²/t) − log2(ISO/100); lux ≈ 2,5 · 2^EV100 (constante de un fotómetro de luz incidente). */
export function luxFromExposure({ ExposureTime, FNumber, ISO }, calibration = 1) {
  if (!ExposureTime || !FNumber || !ISO) return null;
  const ev100 = Math.log2((FNumber * FNumber) / ExposureTime) - Math.log2(ISO / 100);
  return Math.max(0, Math.round(2.5 * 2 ** ev100 * calibration));
}

export const category = (lux) => (lux < 1000 ? 'shade' : lux <= 10000 ? 'indirect' : 'direct');
export const CATEGORY_LUX = { shade: 400, indirect: 4000, direct: 20000 };
const ORDER = ['shade', 'indirect', 'direct'];

/** Compara la luz medida con lo que necesita la especie. */
export function fit(need, measured) {
  const d = ORDER.indexOf(measured) - ORDER.indexOf(need);
  if (d === 0) return 'good';
  return d < 0 ? 'too-dark' : 'too-bright';
}

/** Posición 0–100 en una escala logarítmica de 100 a 25.000 lux. */
export const scalePos = (lux) => Math.min(98, Math.max(2, ((Math.log10(Math.max(lux, 1)) - 2) / (Math.log10(25000) - 2)) * 100));
