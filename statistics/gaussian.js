/**
 * @module statistics/gaussian
 * @description Distribución normal: densidad, acumulada y construcción de la
 * curva para graficar (port fiel de `gaussPDF` / `construirCurva` del legado,
 * líneas 862–878 del Archivo 1), sin dependencia de Chart.js ni del DOM.
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C, esNumeroFinito, valoresNumericos } from './scientific-error.js';
import { media, desviacionEstandar } from './analytics.js';

/** σ por debajo de la cual la densidad se trata como degenerada (legado: 0.01). */
const SIGMA_DEGENERADA = 0.01;

/**
 * Densidad de la normal N(μ, σ²) en x. Con σ degenerada devuelve 1 en x = μ y
 * 0 en otro caso (comportamiento del legado), en vez de dividir por ~0.
 * @param {number} x @param {number} mu @param {number} sigma
 * @returns {number}
 */
export function gaussPDF(x, mu, sigma) {
  if (![x, mu, sigma].every(esNumeroFinito) || sigma < 0) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'gaussPDF requiere x, μ, σ finitos y σ ≥ 0.');
  }
  if (sigma < SIGMA_DEGENERADA) return x === mu ? 1 : 0;
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
}

/**
 * Función de error erf(x), por la serie sin alternancia de signos
 * erf(x) = 2/√π · e^(−x²) · Σ 2ⁿ x^(2n+1) / (2n+1)!!, numéricamente estable
 * (todos los términos positivos) y exacta a ~1e-15 para |x| < 6; fuera de ese
 * rango erf vale ±1 con error < 1e-16.
 * @param {number} x
 * @returns {number}
 */
export function erf(x) {
  if (!esNumeroFinito(x)) throw new ScientificError(C.ENTRADA_INVALIDA, 'erf requiere un número finito.');
  const ax = Math.abs(x);
  if (ax >= 6) return Math.sign(x);
  let termino = ax;
  let suma = ax;
  for (let n = 1; n < 400; n += 1) {
    termino *= (2 * ax * ax) / (2 * n + 1);
    suma += termino;
    if (termino < suma * 1e-17) break;
  }
  return Math.sign(x) * ((2 / Math.sqrt(Math.PI)) * Math.exp(-ax * ax) * suma);
}

/**
 * Distribución acumulada Φ((x − μ)/σ) de la normal N(μ, σ²).
 * @param {number} x @param {number} [mu=0] @param {number} [sigma=1] Debe ser > 0.
 * @returns {number} Probabilidad en [0, 1].
 */
export function gaussCDF(x, mu = 0, sigma = 1) {
  if (![x, mu, sigma].every(esNumeroFinito) || sigma <= 0) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'gaussCDF requiere x, μ finitos y σ > 0.');
  }
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

/**
 * Probabilidad de que una variable N(μ, σ²) caiga en [a, b].
 * @returns {number}
 */
export function probabilidadEntre(a, b, mu, sigma) {
  if (!esNumeroFinito(a) || !esNumeroFinito(b) || a > b) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'probabilidadEntre requiere a ≤ b finitos.');
  }
  return gaussCDF(b, mu, sigma) - gaussCDF(a, mu, sigma);
}

/**
 * Construye la curva gaussiana ajustada a una serie, lista para graficar.
 * Reproduce `construirCurva` del legado: σ muestral; con un solo dato o
 * σ < `sigmaMinimo` se usa `sigmaSustituto`; dominio [max(0, μ−3.5σ), μ+3.5σ]
 * en 100 intervalos (el recorte en 0 es válido porque tiempos y errores no
 * son negativos; para otras magnitudes se pasa `dominioMinimo: -Infinity`).
 * @param {unknown} valores
 * @param {{puntos?: number, desviacionesRango?: number, dominioMinimo?: number,
 *   sigmaMinimo?: number, sigmaSustituto?: number}} [opciones]
 * @returns {{puntos: Array<{x: number, y: number}>, media: number, desviacion: number}}
 */
export function construirCurva(
  valores,
  { puntos = 100, desviacionesRango = 3.5, dominioMinimo = 0, sigmaMinimo = 0.3, sigmaSustituto = 1 } = {},
) {
  const v = valoresNumericos(valores);
  if (!Number.isInteger(puntos) || puntos < 1) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'construirCurva requiere un número de intervalos entero ≥ 1.');
  }
  if (v.length === 0) return { puntos: [], media: 0, desviacion: sigmaSustituto };

  const mu = media(v);
  const sigmaMuestral = desviacionEstandar(v);
  const sigma = sigmaMuestral === null || sigmaMuestral < sigmaMinimo ? sigmaSustituto : sigmaMuestral;
  const xMin = Math.max(dominioMinimo, mu - desviacionesRango * sigma);
  const xMax = mu + desviacionesRango * sigma;
  const paso = (xMax - xMin) / puntos;

  const curva = Array.from({ length: puntos + 1 }, (_, i) => {
    const x = xMin + i * paso;
    return { x: Number(x.toFixed(3)), y: Number(gaussPDF(x, mu, sigma).toFixed(7)) };
  });
  return { puntos: curva, media: mu, desviacion: sigma };
}

export default { gaussPDF, gaussCDF, erf, probabilidadEntre, construirCurva };
