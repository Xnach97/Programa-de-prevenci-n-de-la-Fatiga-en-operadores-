/**
 * @module services/reglas-service
 * @description Evalúa las reglas y plantillas de recomendación de la empresa
 * tras una evaluación y publica alertas/recomendaciones (idempotente: una regla
 * genera una alerta por evaluación).
 */

import { evaluarCondicion, validarCondicion, resolverMensaje, percentilesRequeridos, formatearNumero, SEVERIDADES } from '../statistics/rules.js';
import { percentil } from '../statistics/percentiles.js';
import { createLogger } from './logger.js';

const logger = createLogger('reglas');
const MIN_HISTORICO = 10; // con menos datos un percentil no es confiable → la hoja queda desconocida

/** Error de dominio para la administración de reglas. */
export class ReglasError extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ReglasError';
    this.codigo = codigo;
  }
}

export class ReglasService {
  /** @param {{reglas: import('../js/repositories/rules-repository.js').ReglasRepository}} deps */
  constructor({ reglas }) {
    if (!reglas) throw new TypeError('ReglasService requiere el repositorio de reglas.');
    this._repo = reglas;
  }

  /**
   * @param {{empresaId: string, operadorId: string, operadorNombre?: string|null, turno?: string,
   *   payload: object, codigosPorVersion: Record<string, string>, indicadoresDia?: Record<string, number>}} datos
   * @returns {Promise<{alertas: number, recomendaciones: number}>}
   */
  async evaluarTrasEvaluacion({ empresaId, operadorId, operadorNombre = null, payload, codigosPorVersion, indicadoresDia = {} }) {
    const [reglas, plantillas] = await Promise.all([this._repo.listarReglas(empresaId), this._repo.listarPlantillas(empresaId)]);
    if (reglas.length === 0 && plantillas.length === 0) return { alertas: 0, recomendaciones: 0 };

    const valores = this._valores(payload, codigosPorVersion, indicadoresDia);
    const historicos = await this._historicos(empresaId, payload.evaluacion_id, [...reglas.map((r) => r.condicion), ...plantillas.map((p) => p.condicion_activacion)]);
    const contexto = {
      valor: (ind) => valores.get(ind),
      percentil: (ind, p) => {
        const h = historicos.get(ind);
        return h && h.length >= MIN_HISTORICO ? percentil(h, p) : undefined;
      },
    };
    const datos = {
      operador: operadorNombre || 'el operador',
      turno: payload.turno,
      ico: formatearNumero(payload.ico_valor),
      fatiga: formatearNumero(indicadoresDia.indice_fatiga),
      atencion: formatearNumero(indicadoresDia.indice_atencion),
    };

    const alertas = [];
    for (const regla of reglas) {
      const r = this._evaluarSegura(regla.condicion, contexto, `regla ${regla.id}`);
      if (!r?.cumple) continue;
      const disparadora = r.hojas.find((h) => h.cumple === true);
      alertas.push({
        regla_id: regla.id,
        operador_id: operadorId,
        evaluacion_id: payload.evaluacion_id,
        severidad: regla.severidad,
        mensaje: resolverMensaje(regla.mensaje_plantilla, { ...datos, umbral: formatearNumero(disparadora?.referencia) }, 600),
      });
    }
    const recomendaciones = [];
    for (const plantilla of plantillas) {
      const r = this._evaluarSegura(plantilla.condicion_activacion, contexto, `plantilla ${plantilla.id}`);
      if (!r?.cumple) continue;
      recomendaciones.push({ evaluacion_id: payload.evaluacion_id, plantilla_id: plantilla.id, texto: resolverMensaje(plantilla.texto, datos, 800) });
    }
    return this._repo.publicarResultado(empresaId, alertas, recomendaciones);
  }

  /** Una regla corrupta no debe impedir evaluar las demás. */
  _evaluarSegura(condicion, contexto, etiqueta) {
    try {
      return evaluarCondicion(condicion, contexto);
    } catch (error) {
      logger.warn('Condición ignorada', { etiqueta, error: String(error) });
      return null;
    }
  }

  _valores(payload, codigosPorVersion, indicadoresDia) {
    const m = new Map();
    if (Number.isFinite(payload.ico_valor)) m.set('ico', payload.ico_valor);
    for (const [k, v] of Object.entries(indicadoresDia)) if (Number.isFinite(v)) m.set(k, v);
    for (const r of payload.resultados ?? []) {
      const codigo = codigosPorVersion?.[r.prueba_version_id];
      if (!codigo) continue;
      if (Number.isFinite(r.tiempo_total_ms)) m.set(`${codigo}.tiempo`, r.tiempo_total_ms);
      if (Number.isFinite(r.puntaje_normalizado)) m.set(`${codigo}.puntaje`, r.puntaje_normalizado);
      if (Number.isFinite(r.errores_totales)) m.set(`${codigo}.errores`, r.errores_totales);
    }
    return m;
  }

  async _historicos(empresaId, evaluacionId, condiciones) {
    const necesarios = new Set();
    for (const c of condiciones) {
      if (!validarCondicion(c).valida) continue;
      for (const { indicador } of percentilesRequeridos(c)) necesarios.add(indicador);
    }
    const mapa = new Map();
    await Promise.all(
      [...necesarios].map(async (indicador) => {
        mapa.set(indicador, await this._repo.historicoMetrica({ empresaId, indicador, excluirEvaluacionId: evaluacionId }));
      }),
    );
    return mapa;
  }

  // ------------------------------------------------------------ administración
  /**
   * Crea una regla de la empresa. Valida estructura en cliente (mensaje inmediato);
   * la BD la vuelve a validar con su CHECK.
   */
  async crearRegla({ empresaId, nombre, condicion, severidad, mensajePlantilla }) {
    const limpio = String(nombre ?? '').trim();
    if (limpio.length < 1 || limpio.length > 120) throw new ReglasError('validacion', 'El nombre debe tener entre 1 y 120 caracteres.');
    if (!SEVERIDADES.includes(severidad)) throw new ReglasError('validacion', 'Severidad inválida.');
    const mensaje = String(mensajePlantilla ?? '').trim();
    if (mensaje.length < 1 || mensaje.length > 400) throw new ReglasError('validacion', 'El mensaje debe tener entre 1 y 400 caracteres.');
    const v = validarCondicion(condicion);
    if (!v.valida) throw new ReglasError('validacion', `Condición inválida: ${v.error}.`);
    return this._repo.crearRegla({ empresaId, nombre: limpio, condicion, severidad, mensajePlantilla: mensaje });
  }

  cambiarEstadoRegla(reglaId, estado) {
    if (!['activa', 'inactiva'].includes(estado)) throw new ReglasError('validacion', 'Estado inválido.');
    return this._repo.cambiarEstadoRegla(reglaId, estado);
  }

  resolverAlerta(alertaId, estado) {
    if (!['atendida', 'descartada'].includes(estado)) throw new ReglasError('validacion', 'Estado inválido.');
    return this._repo.resolverAlerta(alertaId, estado);
  }
}

export default { ReglasService, ReglasError };
