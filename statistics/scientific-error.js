/**
 * @module statistics/scientific-error
 * @description Error tipado del Scientific Engine. Un cálculo científico nunca
 * debe "adivinar": ante entradas inválidas lanza este error con un `codigo`
 * estable, para que la capa de aplicación decida cómo informarlo.
 */

export const CODIGOS_CIENTIFICOS = Object.freeze({
  ENTRADA_INVALIDA: 'entrada_invalida',
  PUNTAJE_FUERA_DE_RANGO: 'puntaje_fuera_de_rango',
  PESOS_INVALIDOS: 'pesos_invalidos',
  BAREMO_INVALIDO: 'baremo_invalido',
  FUNCION_PUNTUACION_DESCONOCIDA: 'funcion_puntuacion_desconocida',
  CONFIGURACION_NO_ENCONTRADA: 'configuracion_no_encontrada',
});

export class ScientificError extends Error {
  /**
   * @param {string} codigo Uno de CODIGOS_CIENTIFICOS.
   * @param {string} mensaje Descripción técnica (en español) para desarrolladores/logs.
   */
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ScientificError';
    this.codigo = codigo;
  }
}

/** @param {unknown} v @returns {v is number} */
export const esNumeroFinito = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Valida y devuelve una copia con solo los números finitos de una lista.
 * Los `null`, `undefined`, `NaN` e `Infinity` se descartan (datos faltantes),
 * pero cualquier otro tipo (p. ej. un string) se rechaza: un "12" que llega
 * como texto es un defecto aguas arriba que no debe ocultarse.
 * @param {unknown} valores
 * @returns {number[]}
 * @throws {ScientificError}
 */
export function valoresNumericos(valores) {
  if (!Array.isArray(valores)) {
    throw new ScientificError(CODIGOS_CIENTIFICOS.ENTRADA_INVALIDA, 'Se esperaba un arreglo de números.');
  }
  const limpios = [];
  for (const v of valores) {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) continue;
    if (typeof v !== 'number') {
      throw new ScientificError(CODIGOS_CIENTIFICOS.ENTRADA_INVALIDA, `Valor no numérico en la serie: ${typeof v}.`);
    }
    limpios.push(v);
  }
  return limpios;
}

export default { ScientificError, CODIGOS_CIENTIFICOS, esNumeroFinito, valoresNumericos };
