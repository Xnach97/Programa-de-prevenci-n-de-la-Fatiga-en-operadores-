/**
 * @module dashboard/chart-math
 * @description Geometría pura de las gráficas SVG (sin DOM): escalas, ticks,
 * rutas y polígonos. Probable en Node.
 */

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * @param {[number, number]} dominio
 * @param {[number, number]} rango
 * @returns {(v: number) => number}
 */
export function escalaLineal([d0, d1], [r0, r1]) {
  if (d0 === d1) return () => r2((r0 + r1) / 2);
  return (v) => r2(r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
}

/**
 * Ticks "agradables" (paso 1, 2, 5 × 10ⁿ) que cubren [min, max].
 * @returns {number[]}
 */
export function ticksAgradables(min, max, cantidad = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new RangeError('Dominio inválido.');
  if (max === min) return [min];
  const bruto = (max - min) / Math.max(cantidad, 1);
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normal = bruto / magnitud;
  const paso = (normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 5 ? 5 : 10) * magnitud;
  const inicio = Math.ceil(min / paso) * paso;
  const ticks = [];
  for (let i = 0, v = inicio; v <= max + paso * 1e-9; i += 1, v = inicio + i * paso) ticks.push(r2(v));
  return ticks;
}

/** Divide una serie en tramos continuos (los `null` cortan la línea; no se interpolan). */
export function segmentos(puntos) {
  const salida = [];
  let actual = [];
  for (const p of puntos) {
    if (p.y === null || p.y === undefined || !Number.isFinite(p.y)) {
      if (actual.length) salida.push(actual);
      actual = [];
    } else {
      actual.push(p);
    }
  }
  if (actual.length) salida.push(actual);
  return salida;
}

/** Ruta SVG `M x y L x y …` de un tramo (un solo punto → `M x y h 0` para que se vea como marca). */
export function rutaLinea(tramo) {
  if (tramo.length === 0) return '';
  const [p0, ...resto] = tramo;
  if (resto.length === 0) return `M${r2(p0.x)} ${r2(p0.y)}h0`;
  return `M${r2(p0.x)} ${r2(p0.y)}${resto.map((p) => `L${r2(p.x)} ${r2(p.y)}`).join('')}`;
}

/** Vértices de un radar con n ejes; el primero apunta arriba y avanza en sentido horario. */
export function puntosRadar(valores, maximo, cx, cy, radio) {
  const n = valores.length;
  return valores.map((v, i) => {
    const angulo = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const fraccion = v === null || v === undefined || !Number.isFinite(v) ? 0 : Math.min(Math.max(v / maximo, 0), 1);
    return { x: r2(cx + Math.cos(angulo) * radio * fraccion), y: r2(cy + Math.sin(angulo) * radio * fraccion), angulo };
  });
}

/** Posición del extremo de un eje del radar (para etiquetas y retícula). */
export function extremoEje(i, n, cx, cy, radio) {
  const angulo = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return { x: r2(cx + Math.cos(angulo) * radio), y: r2(cy + Math.sin(angulo) * radio), angulo };
}

export const poligono = (puntos) => puntos.map((p) => `${p.x},${p.y}`).join(' ');

const MS_DIA = 86_400_000;
const aMs = (d) => Date.parse(`${d}T00:00:00Z`);

/** @param {{desde: string, hasta: string}} f ¿Periodo de exactamente un día? */
export const esPeriodoDiario = (f) => aMs(f.hasta) - aMs(f.desde) === MS_DIA;

/** Días consecutivos 'YYYY-MM-DD' desde `desde` hasta `hasta` (ambos inclusive). */
export function diasEntre(desde, hasta) {
  const dias = [];
  for (let t = aMs(desde); t <= aMs(hasta); t += MS_DIA) dias.push(new Date(t).toISOString().slice(0, 10));
  return dias;
}

/**
 * Serie diaria continua: un punto por día, `null` donde no hay dato.
 * @param {Array<{desde: string, valor: number}>} filas Filas de periodo diario.
 * @returns {Array<{dia: string, valor: number|null}>}
 */
export function serieDiaria(filas, desde, hasta) {
  const porDia = new Map(filas.map((f) => [f.desde, f.valor]));
  return diasEntre(desde, hasta).map((dia) => ({ dia, valor: porDia.has(dia) ? porDia.get(dia) : null }));
}

/** 'YYYY-MM-DD' → 'dd/mm'. */
export const etiquetaDia = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** Etiqueta anónima y estable para un id (gráficas científicas sin identidad). */
export function etiquetaAnonima(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return `O-${h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6)}`;
}

export default { escalaLineal, ticksAgradables, segmentos, rutaLinea, puntosRadar, esPeriodoDiario, serieDiaria, etiquetaAnonima };
