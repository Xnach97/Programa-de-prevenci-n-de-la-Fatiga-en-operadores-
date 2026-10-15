/**
 * @module statistics/percentiles
 * @description Percentiles por interpolación lineal (método 7 de Hyndman–Fan,
 * el de Excel `PERCENTILE.INC` y NumPy por defecto). Es el mismo algoritmo
 * del legado (`perc()`, Archivo 2 línea 875) pero SIN redondear: el redondeo
 * es decisión de presentación, no del motor.
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C, esNumeroFinito, valoresNumericos } from './scientific-error.js';

/**
 * @param {unknown} valores
 * @param {number} p Percentil en [0, 100].
 * @returns {number|null} Null si no hay datos.
 * @throws {ScientificError} Si p está fuera de rango.
 */
export function percentil(valores, p) {
  if (!esNumeroFinito(p) || p < 0 || p > 100) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'El percentil debe estar entre 0 y 100.');
  }
  const ordenados = valoresNumericos(valores).sort((a, b) => a - b);
  return percentilDeOrdenados(ordenados, p);
}

/**
 * Varios percentiles con una sola ordenación.
 * @param {unknown} valores
 * @param {number[]} ps
 * @returns {Record<number, number|null>} Mapa p → valor.
 */
export function percentiles(valores, ps) {
  if (!Array.isArray(ps) || ps.some((p) => !esNumeroFinito(p) || p < 0 || p > 100)) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'Todos los percentiles deben estar entre 0 y 100.');
  }
  const ordenados = valoresNumericos(valores).sort((a, b) => a - b);
  return Object.fromEntries(ps.map((p) => [p, percentilDeOrdenados(ordenados, p)]));
}

/** @private Requiere `ordenados` ya ordenado ascendentemente. */
function percentilDeOrdenados(ordenados, p) {
  if (ordenados.length === 0) return null;
  const posicion = (p / 100) * (ordenados.length - 1);
  const bajo = Math.floor(posicion);
  const alto = Math.ceil(posicion);
  return ordenados[bajo] + (ordenados[alto] - ordenados[bajo]) * (posicion - bajo);
}

/**
 * Rango percentil de un valor dentro de una distribución (método de rango
 * medio): (menores + ½·iguales) / n × 100. Responde "¿qué porcentaje de la
 * población está por debajo de este operador?".
 * @param {unknown} valores
 * @param {number} x
 * @returns {number|null} Null sin datos.
 */
export function rangoPercentil(valores, x) {
  if (!esNumeroFinito(x)) throw new ScientificError(C.ENTRADA_INVALIDA, 'rangoPercentil requiere un valor finito.');
  const v = valoresNumericos(valores);
  if (v.length === 0) return null;
  let menores = 0;
  let iguales = 0;
  for (const y of v) {
    if (y < x) menores += 1;
    else if (y === x) iguales += 1;
  }
  return ((menores + 0.5 * iguales) / v.length) * 100;
}

export default { percentil, percentiles, rangoPercentil };
