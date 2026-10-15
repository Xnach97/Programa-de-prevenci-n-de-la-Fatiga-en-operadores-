/**
 * @module services/evaluacion-service
 * @description Casos de uso de la evaluación cognitiva (Fase 2 §4): qué pruebas
 * corresponden a una empresa, normalización de resultados, cálculo del ICO y
 * armado del payload de `registrar_evaluacion`.
 *
 * Sin DOM. Dependencias inyectadas:
 *  - `testing`   repositorio (listarActivas, registrar)
 *  - `motor`     ScientificService (calcularPuntajes/evaluar)
 *  - `registro`  TestRegistry
 *  - `guardar`   (payload) => Promise — por defecto `testing.registrar`; el
 *                Offline Engine (Módulo 9) lo sustituye por una cola con reintento.
 */

import { puntuar } from '../statistics/score.js';
import { ScientificError, CODIGOS_CIENTIFICOS } from '../statistics/scientific-error.js';

export const TURNOS_DEFECTO = Object.freeze(['Diurno', 'Nocturno']);

/** Error de dominio con código estable para la UI. */
export class EvaluacionError extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'EvaluacionError';
    this.codigo = codigo;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {object} configuracion `configuracion_empresa` @returns {string[]} */
export function turnosDeEmpresa(configuracion) {
  const turnos = configuracion?.turnos;
  if (!Array.isArray(turnos) || turnos.length === 0) return [...TURNOS_DEFECTO];
  return turnos
    .map((x) => (typeof x === 'string' ? x : x?.nombre))
    .filter((x) => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim());
}

export class EvaluacionService {
  /**
   * @param {{testing: object, motor: object, registro: import('../tests/test-registry.js').TestRegistry,
   *   guardar?: (payload: object) => Promise<object>, generarId?: () => string, dispositivoId?: string|null}} deps
   */
  constructor({ testing, motor, registro, guardar, generarId = () => crypto.randomUUID(), dispositivoId = null }) {
    if (!testing || !motor || !registro) throw new TypeError('EvaluacionService requiere testing, motor y registro.');
    this._testing = testing;
    this._motor = motor;
    this._registro = registro;
    this._guardar = guardar ?? ((payload) => testing.registrar(payload));
    this._generarId = generarId;
    this._dispositivoId = dispositivoId;
  }

  /**
   * Pruebas que la empresa tiene activas Y que la app sabe ejecutar.
   * `pruebas_activas` vacío = todas las activas del catálogo.
   * @param {object|null} configuracion
   * @returns {Promise<Array<{prueba: object, version: object, definicion: object}>>}
   */
  async cargarPruebas(configuracion) {
    const filas = await this._testing.listarActivas();
    const habilitadas = Array.isArray(configuracion?.pruebas_activas) ? configuracion.pruebas_activas : [];
    return filas
      .filter((f) => f.version_actual && this._registro.has(f.codigo))
      .filter((f) => habilitadas.length === 0 || habilitadas.includes(f.codigo))
      .map((f) => ({ prueba: f, version: f.version_actual, definicion: this._registro.get(f.codigo) }));
  }

  /**
   * Normaliza un resultado crudo de una prueba a 0–100.
   * @param {{version: object, definicion: object}} entrada
   * @param {{tiempo_total_ms: number|null, errores_totales: number, metricas: object}} resultado
   * @returns {number}
   */
  normalizar({ version, definicion }, resultado) {
    const crudo = definicion.crudo(resultado, version.funcion_puntuacion, version.parametros);
    return puntuar(version.funcion_puntuacion, crudo, version.parametros);
  }

  /**
   * Cierra una evaluación: puntajes, ICO/clasificación y payload.
   * No guarda: devuelve el payload para que la UI lo envíe con `guardar()`
   * y pueda reintentar el MISMO payload (mismo evaluacion_id → idempotente).
   * @param {{empresaId: string, operador: {id: string, cargo_id?: string|null}, turno: string, fecha?: Date,
   *   ejecuciones: Array<{prueba: object, version: object, definicion: object, resultado: object}>}} entrada
   */
  async cerrar({ empresaId, operador, turno, fecha = new Date(), ejecuciones }) {
    if (!UUID.test(empresaId ?? '') || !UUID.test(operador?.id ?? '')) {
      throw new EvaluacionError('entrada_invalida', 'empresaId y operador.id deben ser UUID.');
    }
    if (typeof turno !== 'string' || turno.trim() === '') throw new EvaluacionError('entrada_invalida', 'Turno requerido.');
    if (!Array.isArray(ejecuciones) || ejecuciones.length === 0) {
      throw new EvaluacionError('entrada_invalida', 'Se requiere al menos una prueba ejecutada.');
    }

    const resultados = ejecuciones.map((e) => {
      const puntaje = this.normalizar(e, e.resultado);
      return {
        codigo: e.prueba.codigo,
        prueba_version_id: e.version.id,
        tiempo_total_ms: e.resultado.tiempo_total_ms ?? null,
        errores_totales: e.resultado.errores_totales ?? 0,
        puntaje_normalizado: puntaje,
        metricas: e.resultado.metricas ?? {},
      };
    });

    const puntajes = Object.fromEntries(resultados.map((r) => [r.codigo, r.puntaje_normalizado]));

    let evaluacionCientifica = null;
    let configuracionFaltante = false;
    try {
      evaluacionCientifica = await this._motor.evaluar({ empresaId, cargoId: operador.cargo_id ?? null, fecha, puntajes });
    } catch (error) {
      // Sin pesos/baremo vigentes la evaluación se registra igual (ico nulo): perder
      // el resultado de un operador por falta de configuración sería peor.
      if (error instanceof ScientificError && error.codigo === CODIGOS_CIENTIFICOS.CONFIGURACION_NO_ENCONTRADA) {
        configuracionFaltante = true;
      } else {
        throw error;
      }
    }

    const ico = evaluacionCientifica?.ico?.valor ?? null;
    const nivel = evaluacionCientifica?.clasificacion?.nivel ?? null;

    const payload = {
      evaluacion_id: this._generarId(),
      empresa_id: empresaId,
      operador_id: operador.id,
      turno: turno.trim(),
      fecha: new Date(fecha).toISOString(),
      dispositivo_id: this._dispositivoId,
      ico_configuracion_id: evaluacionCientifica?.icoConfiguracionId ?? null,
      baremo_snapshot_id: evaluacionCientifica?.baremoId ?? null,
      ico_valor: ico,
      ico_nivel: nivel,
      resultados: resultados.map(({ codigo: _codigo, ...fila }) => fila),
    };

    return { payload, resumen: { resultados, ico, nivel, configuracionFaltante, motivo: evaluacionCientifica?.ico?.motivo ?? null } };
  }

  /**
   * Envía el payload. Idempotente en servidor: reenviar el mismo payload no duplica.
   * @param {object} payload
   * @returns {Promise<{evaluacion_id: string, duplicada: boolean}>}
   */
  guardar(payload) {
    return this._guardar(payload);
  }
}

export default { EvaluacionService, EvaluacionError, turnosDeEmpresa, TURNOS_DEFECTO };
