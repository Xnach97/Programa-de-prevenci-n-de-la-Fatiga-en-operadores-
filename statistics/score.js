/**
 * @module statistics/score
 * @description Normalización de resultados crudos a la escala común 0–100
 * (Fase 2 §2; Fase 3 §6: `resultados_pruebas.puntaje_normalizado`, "calculado
 * por el Scientific Engine, nunca por el frontend").
 *
 * Cada versión de prueba nombra su función en
 * `pruebas_versiones.funcion_puntuacion`; aquí vive el REGISTRO de esas
 * funciones. Se incluyen cuatro puntuadoras genéricas parametrizadas por
 * `pruebas_versiones.parametros`; el Testing Engine (Módulo 5) puede registrar
 * las propias de cada prueba con `registrarFuncionPuntuacion`.
 *
 * Contrato de una función de puntuación: `(crudo, parametros) => número`.
 * El motor valida que el resultado sea finito, lo acota a [0, 100] solo si se
 * desvía por redondeo de coma flotante (≤ 1e-9) —cualquier otro exceso es un
 * defecto de la función y lanza error— y lo redondea a 2 decimales
 * (`numeric(5,2)`).
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C, esNumeroFinito } from './scientific-error.js';
import { gaussCDF } from './gaussian.js';

const TOLERANCIA_RANGO = 1e-9;

/** @type {Map<string, (crudo: any, parametros: any) => number>} */
const registro = new Map();

/** Identificadores de las puntuadoras incluidas. */
export const FUNCIONES_PUNTUACION = Object.freeze({
  LINEAL_MENOR_MEJOR: 'lineal_menor_mejor',
  LINEAL_MAYOR_MEJOR: 'lineal_mayor_mejor',
  COMPUESTA_TIEMPO_ERRORES: 'compuesta_tiempo_errores',
  PERCENTIL_GAUSSIANO: 'percentil_gaussiano',
});

/** Acota x a [min, max]. */
export const acotar = (x, min, max) => Math.min(Math.max(x, min), max);

/**
 * Normalización min–max a 0–100 con saturación en los extremos.
 * @param {number} valor
 * @param {number} cero Valor que corresponde a 0 puntos.
 * @param {number} cien Valor que corresponde a 100 puntos (puede ser menor que `cero`).
 * @returns {number} Puntaje sin redondear, en [0, 100].
 */
export function normalizarLineal(valor, cero, cien) {
  if (![valor, cero, cien].every(esNumeroFinito) || cero === cien) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'normalizarLineal requiere valores finitos y extremos distintos.');
  }
  return acotar(((valor - cero) / (cien - cero)) * 100, 0, 100);
}

function exigirNumero(valor, nombre) {
  if (!esNumeroFinito(valor)) {
    throw new ScientificError(C.ENTRADA_INVALIDA, `Falta "${nombre}" o no es un número finito.`);
  }
  return valor;
}

/** crudo: número o {valor}. parametros: {mejor, peor} (p. ej. ms de reacción). */
function linealMenorMejor(crudo, parametros) {
  const x = exigirNumero(typeof crudo === 'number' ? crudo : crudo?.valor, 'valor');
  return normalizarLineal(x, exigirNumero(parametros?.peor, 'peor'), exigirNumero(parametros?.mejor, 'mejor'));
}

/** crudo: número o {valor}. parametros: {minimo, maximo} (p. ej. nivel máximo de memoria). */
function linealMayorMejor(crudo, parametros) {
  const x = exigirNumero(typeof crudo === 'number' ? crudo : crudo?.valor, 'valor');
  return normalizarLineal(x, exigirNumero(parametros?.minimo, 'minimo'), exigirNumero(parametros?.maximo, 'maximo'));
}

/**
 * Prueba con tiempo y errores. crudo: {tiempo_ms, errores}.
 * parametros: {tiempo_mejor_ms, tiempo_peor_ms, errores_maximo, peso_tiempo?=0.5}.
 * Puntaje = peso_tiempo·P(tiempo) + (1−peso_tiempo)·P(errores), con
 * P(errores)=100 sin errores y 0 en `errores_maximo` o más.
 */
function compuestaTiempoErrores(crudo, parametros) {
  const tiempo = exigirNumero(crudo?.tiempo_ms, 'tiempo_ms');
  const errores = exigirNumero(crudo?.errores, 'errores');
  const pesoTiempo = parametros?.peso_tiempo ?? 0.5;
  if (!esNumeroFinito(pesoTiempo) || pesoTiempo < 0 || pesoTiempo > 1) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'peso_tiempo debe estar entre 0 y 1.');
  }
  const erroresMax = exigirNumero(parametros?.errores_maximo, 'errores_maximo');
  if (erroresMax <= 0) throw new ScientificError(C.ENTRADA_INVALIDA, 'errores_maximo debe ser > 0.');
  const pTiempo = normalizarLineal(
    tiempo,
    exigirNumero(parametros?.tiempo_peor_ms, 'tiempo_peor_ms'),
    exigirNumero(parametros?.tiempo_mejor_ms, 'tiempo_mejor_ms'),
  );
  const pErrores = normalizarLineal(errores, erroresMax, 0);
  return pesoTiempo * pTiempo + (1 - pesoTiempo) * pErrores;
}

/**
 * Puntaje por posición en una distribución normal de referencia:
 * 100·Φ(z) (mayor_mejor) o 100·(1−Φ(z)) (menor_mejor). crudo: número o {valor}.
 * parametros: {media, desviacion, direccion?='menor_mejor'}.
 */
function percentilGaussiano(crudo, parametros) {
  const x = exigirNumero(typeof crudo === 'number' ? crudo : crudo?.valor, 'valor');
  const mu = exigirNumero(parametros?.media, 'media');
  const sigma = exigirNumero(parametros?.desviacion, 'desviacion');
  if (sigma <= 0) throw new ScientificError(C.ENTRADA_INVALIDA, 'desviacion debe ser > 0.');
  const direccion = parametros?.direccion ?? 'menor_mejor';
  if (direccion !== 'menor_mejor' && direccion !== 'mayor_mejor') {
    throw new ScientificError(C.ENTRADA_INVALIDA, `direccion desconocida: ${direccion}.`);
  }
  const p = gaussCDF(x, mu, sigma);
  return 100 * (direccion === 'mayor_mejor' ? p : 1 - p);
}

registro.set(FUNCIONES_PUNTUACION.LINEAL_MENOR_MEJOR, linealMenorMejor);
registro.set(FUNCIONES_PUNTUACION.LINEAL_MAYOR_MEJOR, linealMayorMejor);
registro.set(FUNCIONES_PUNTUACION.COMPUESTA_TIEMPO_ERRORES, compuestaTiempoErrores);
registro.set(FUNCIONES_PUNTUACION.PERCENTIL_GAUSSIANO, percentilGaussiano);

/**
 * Registra una función de puntuación propia de una prueba. No permite
 * sobrescribir una existente: reemplazar silenciosamente la fórmula cambiaría
 * el significado de resultados históricos (decisión 0.2 de Fase 2).
 * @param {string} id
 * @param {(crudo: any, parametros: any) => number} funcion
 */
export function registrarFuncionPuntuacion(id, funcion) {
  if (typeof id !== 'string' || id.trim() === '' || typeof funcion !== 'function') {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'registrarFuncionPuntuacion requiere un id y una función.');
  }
  if (registro.has(id)) {
    throw new ScientificError(C.ENTRADA_INVALIDA, `La función de puntuación "${id}" ya está registrada.`);
  }
  registro.set(id, funcion);
}

/** @returns {string[]} Identificadores registrados, ordenados. */
export function listarFuncionesPuntuacion() {
  return [...registro.keys()].sort();
}

/**
 * Calcula el puntaje normalizado 0–100 (2 decimales) de un resultado crudo.
 * @param {string} funcionId `pruebas_versiones.funcion_puntuacion`.
 * @param {any} crudo Resultado de la prueba (forma que la función espera).
 * @param {object} [parametros] `pruebas_versiones.parametros`.
 * @returns {number}
 * @throws {ScientificError} Función desconocida, entradas inválidas o resultado fuera de rango.
 */
export function puntuar(funcionId, crudo, parametros = {}) {
  const funcion = registro.get(funcionId);
  if (!funcion) {
    throw new ScientificError(C.FUNCION_PUNTUACION_DESCONOCIDA, `No existe la función de puntuación "${funcionId}".`);
  }
  const bruto = funcion(crudo, parametros);
  if (!esNumeroFinito(bruto)) {
    throw new ScientificError(C.PUNTAJE_FUERA_DE_RANGO, `"${funcionId}" no devolvió un número finito.`);
  }
  if (bruto < -TOLERANCIA_RANGO || bruto > 100 + TOLERANCIA_RANGO) {
    throw new ScientificError(C.PUNTAJE_FUERA_DE_RANGO, `"${funcionId}" devolvió ${bruto}, fuera de [0, 100].`);
  }
  return Math.round(acotar(bruto, 0, 100) * 100) / 100;
}

export default { puntuar, registrarFuncionPuntuacion, listarFuncionesPuntuacion, normalizarLineal, FUNCIONES_PUNTUACION };
