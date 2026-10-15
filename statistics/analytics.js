/**
 * @module statistics/analytics
 * @description Estadística descriptiva (Fase 2 §2: media, desviación, CV,
 * outliers, z-score, promedio móvil). Funciones puras, sin DOM ni red.
 *
 * Unifica el cálculo que el legado escribía dos veces con criterios distintos:
 * el Archivo 1 usaba varianza MUESTRAL (n−1) y el Archivo 2 POBLACIONAL (n).
 * Aquí el criterio es explícito (`muestral`, por defecto `true`) y los datos
 * faltantes se descartan de forma consistente (ver `valoresNumericos`).
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C, esNumeroFinito, valoresNumericos } from './scientific-error.js';
import { percentil } from './percentiles.js';

/** @param {unknown} valores @returns {number|null} Media aritmética o null sin datos. */
export function media(valores) {
  const v = valoresNumericos(valores);
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * @param {unknown} valores
 * @param {{muestral?: boolean}} [opciones] `muestral=true` divide por n−1.
 * @returns {number|null} Null si hay menos datos de los necesarios (1 poblacional, 2 muestral).
 */
export function varianza(valores, { muestral = true } = {}) {
  const v = valoresNumericos(valores);
  const minimo = muestral ? 2 : 1;
  if (v.length < minimo) return null;
  const mu = v.reduce((a, b) => a + b, 0) / v.length;
  const sumaCuadrados = v.reduce((a, b) => a + (b - mu) ** 2, 0);
  return sumaCuadrados / (muestral ? v.length - 1 : v.length);
}

/** @returns {number|null} */
export function desviacionEstandar(valores, opciones) {
  const s2 = varianza(valores, opciones);
  return s2 === null ? null : Math.sqrt(s2);
}

/** @returns {number|null} Mediana (percentil 50). */
export function mediana(valores) {
  return percentil(valores, 50);
}

/**
 * Coeficiente de variación = σ / |μ|, como fracción (0.15 = 15 %).
 * @returns {number|null} Null si σ no existe o la media es 0.
 */
export function coeficienteVariacion(valores, opciones) {
  const mu = media(valores);
  const sigma = desviacionEstandar(valores, opciones);
  if (mu === null || sigma === null || mu === 0) return null;
  return sigma / Math.abs(mu);
}

/**
 * Puntaje z = (x − μ) / σ.
 * @param {number} x
 * @param {number} mu
 * @param {number} sigma Debe ser > 0.
 * @returns {number}
 * @throws {ScientificError} Si σ no es positiva o las entradas no son finitas.
 */
export function zScore(x, mu, sigma) {
  if (![x, mu, sigma].every(esNumeroFinito) || sigma <= 0) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'zScore requiere x, μ finitos y σ > 0.');
  }
  return (x - mu) / sigma;
}

/**
 * Variación porcentual de `actual` respecto de `base` (0.2 = +20 %).
 * @returns {number|null} Null si la base es 0 o alguna entrada no es finita.
 */
export function variacionRelativa(base, actual) {
  if (!esNumeroFinito(base) || !esNumeroFinito(actual) || base === 0) return null;
  return (actual - base) / Math.abs(base);
}

/**
 * Valores atípicos. Método `z` (|z| > umbral, con σ muestral) o `iqr` (Tukey:
 * fuera de [Q1 − k·IQR, Q3 + k·IQR]). Devuelve índices sobre la serie ORIGINAL
 * (con huecos), para poder marcar `es_valido_para_analisis` sin perder posición.
 * @param {Array<number|null|undefined>} valores
 * @param {{metodo?: 'z'|'iqr', umbral?: number}} [opciones]
 * @returns {{indices: number[], limiteInferior: number|null, limiteSuperior: number|null}}
 */
export function detectarOutliers(valores, { metodo = 'iqr', umbral } = {}) {
  const limpios = valoresNumericos(valores);
  if (metodo !== 'z' && metodo !== 'iqr') {
    throw new ScientificError(C.ENTRADA_INVALIDA, `Método de outliers desconocido: ${metodo}.`);
  }
  let inferior = null;
  let superior = null;
  if (metodo === 'z') {
    const k = umbral ?? 3;
    const mu = media(limpios);
    const sigma = desviacionEstandar(limpios);
    if (sigma !== null && sigma > 0) {
      inferior = mu - k * sigma;
      superior = mu + k * sigma;
    }
  } else {
    const k = umbral ?? 1.5;
    const q1 = percentil(limpios, 25);
    const q3 = percentil(limpios, 75);
    if (q1 !== null && q3 !== null) {
      inferior = q1 - k * (q3 - q1);
      superior = q3 + k * (q3 - q1);
    }
  }
  const indices = [];
  if (inferior !== null) {
    valores.forEach((v, i) => {
      if (esNumeroFinito(v) && (v < inferior || v > superior)) indices.push(i);
    });
  }
  return { indices, limiteInferior: inferior, limiteSuperior: superior };
}

/**
 * Promedio móvil FINAL (ventana hacia atrás). Las posiciones con menos de
 * `ventana` datos válidos disponibles quedan en `null` (no se extrapola).
 * @param {Array<number|null|undefined>} valores
 * @param {number} ventana Entero ≥ 1.
 * @returns {Array<number|null>} Misma longitud que la entrada.
 */
export function promedioMovil(valores, ventana) {
  if (!Array.isArray(valores) || !Number.isInteger(ventana) || ventana < 1) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'promedioMovil requiere un arreglo y una ventana entera ≥ 1.');
  }
  return valores.map((_, i) => {
    if (i + 1 < ventana) return null;
    const tramo = valores.slice(i + 1 - ventana, i + 1);
    if (!tramo.every(esNumeroFinito)) return null;
    return tramo.reduce((a, b) => a + b, 0) / ventana;
  });
}

/**
 * Histograma de clases de igual ancho, con el último intervalo cerrado.
 * @param {unknown} valores
 * @param {{clases?: number, minimo?: number, maximo?: number}} [opciones]
 * @returns {{limites: number[], conteos: number[]}} `limites` tiene clases+1 elementos.
 */
export function histograma(valores, { clases = 10, minimo, maximo } = {}) {
  const v = valoresNumericos(valores);
  if (!Number.isInteger(clases) || clases < 1) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'histograma requiere un número de clases entero ≥ 1.');
  }
  if (v.length === 0) return { limites: [], conteos: [] };
  const lo = minimo ?? Math.min(...v);
  let hi = maximo ?? Math.max(...v);
  if (hi === lo) hi = lo + 1; // serie constante: una sola clase poblada
  const ancho = (hi - lo) / clases;
  const limites = Array.from({ length: clases + 1 }, (_, i) => lo + i * ancho);
  const conteos = new Array(clases).fill(0);
  for (const x of v) {
    if (x < lo || x > hi) continue;
    conteos[Math.min(Math.floor((x - lo) / ancho), clases - 1)] += 1;
  }
  return { limites, conteos };
}

/**
 * Resumen descriptivo completo de una serie (insumo de dashboards e indicadores).
 * @param {unknown} valores
 * @param {{muestral?: boolean}} [opciones]
 * @returns {{n: number, media: number|null, desviacion: number|null, mediana: number|null,
 *   coeficienteVariacion: number|null, minimo: number|null, maximo: number|null,
 *   p25: number|null, p75: number|null, p90: number|null}}
 */
export function resumenDescriptivo(valores, opciones) {
  const v = valoresNumericos(valores);
  return {
    n: v.length,
    media: media(v),
    desviacion: desviacionEstandar(v, opciones),
    mediana: mediana(v),
    coeficienteVariacion: coeficienteVariacion(v, opciones),
    minimo: v.length ? Math.min(...v) : null,
    maximo: v.length ? Math.max(...v) : null,
    p25: percentil(v, 25),
    p75: percentil(v, 75),
    p90: percentil(v, 90),
  };
}

export default {
  media, varianza, desviacionEstandar, mediana, coeficienteVariacion, zScore, variacionRelativa,
  detectarOutliers, promedioMovil, histograma, resumenDescriptivo,
};
