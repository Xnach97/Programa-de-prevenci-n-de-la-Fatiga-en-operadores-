/**
 * @module tests/test-registry
 * @description Registro de pruebas cognitivas (Fase 2 §3: `test-registry.js`).
 * Cada prueba de `/tests` se registra a sí misma; `app.js` nunca tiene una
 * lista fija: lee el registro, filtrado por la configuración de la empresa.
 *
 * Una DEFINICIÓN de prueba es:
 *   codigo        id estable (= `pruebas.codigo` en BD)
 *   instrucciones claves i18n del tutorial (pasos)
 *   ejecutar(contenedor, {parametros, rng}) -> Promise<ResultadoPrueba>
 *   crudo(resultado, funcionPuntuacion, parametros) -> entrada para `puntuar()`
 *
 * ResultadoPrueba = { tiempo_total_ms, errores_totales, metricas }
 *
 * La lógica de cada prueba (generación y evaluación) es PURA y está exportada
 * aparte de `ejecutar` (que toca el DOM), para probarla sin navegador.
 */

export class TestRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._pruebas = new Map();
  }

  /**
   * @param {{codigo: string, instrucciones: string[], ejecutar: Function, crudo: Function}} definicion
   */
  register(definicion) {
    const { codigo, ejecutar, crudo, instrucciones } = definicion ?? {};
    if (typeof codigo !== 'string' || !/^[a-z][a-z0-9_]{2,59}$/.test(codigo)) {
      throw new TypeError(`Código de prueba inválido: "${String(codigo)}".`);
    }
    if (typeof ejecutar !== 'function' || typeof crudo !== 'function' || !Array.isArray(instrucciones)) {
      throw new TypeError(`La prueba "${codigo}" requiere ejecutar(), crudo() e instrucciones[].`);
    }
    if (this._pruebas.has(codigo)) throw new Error(`La prueba "${codigo}" ya está registrada.`);
    this._pruebas.set(codigo, Object.freeze({ ...definicion }));
  }

  /** @returns {object|undefined} */
  get(codigo) {
    return this._pruebas.get(codigo);
  }

  has(codigo) {
    return this._pruebas.has(codigo);
  }

  /** @returns {object[]} En orden de registro. */
  list() {
    return [...this._pruebas.values()];
  }
}

/** Registro único de la aplicación. */
export const testRegistry = new TestRegistry();

/**
 * Entrada para `puntuar()` según la función de puntuación de la versión.
 * Las funciones genéricas del Scientific Engine tienen un contrato de `crudo`
 * conocido; una función propia de la prueba lo resuelve la definición.
 * @param {object} definicion
 * @param {object} resultado
 * @param {string} funcionPuntuacion
 * @param {object} parametros Parámetros de la versión.
 */
export function construirCrudo(definicion, resultado, funcionPuntuacion, parametros) {
  return definicion.crudo(resultado, funcionPuntuacion, parametros);
}

export default { TestRegistry, testRegistry, construirCrudo };
