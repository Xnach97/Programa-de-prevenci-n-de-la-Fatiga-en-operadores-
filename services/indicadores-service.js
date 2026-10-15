/**
 * @module services/indicadores-service
 * @description Recálculo de indicadores (Fase 3 §8). Tras registrarse una
 * evaluación se recalculan, para el día de la evaluación (hora de Colombia):
 *   1. los indicadores del OPERADOR (ventana diaria y de 30 días);
 *   2. los de GRUPO (área, cargo, empresa) agregando los valores por operador
 *      ya almacenados — sin releer todas las evaluaciones de la empresa.
 * Idempotente: recalcular el mismo día sobrescribe, no duplica.
 */

import {
  calcularIndicadoresOperador,
  calcularIndicadoresGrupo,
  ventanas,
  fechaLocal,
  inicioDiaLocalISO,
  CODIGOS_INDICADOR as C,
} from '../statistics/indicadores.js';

const TTL_MAPA_MS = 5 * 60_000;
const POR_OPERADOR = [C.ICO_TRABAJADOR, C.INDICE_FATIGA, C.INDICE_RIESGO];

export class IndicadoresService {
  /**
   * @param {{indicadores: import('../js/repositories/indicadores-repository.js').IndicadoresRepository}} deps
   */
  constructor({ indicadores, ahora = () => Date.now() }) {
    if (!indicadores) throw new TypeError('IndicadoresService requiere el repositorio de indicadores.');
    this._repo = indicadores;
    this._ahora = ahora;
    this._mapaCache = new Map(); // empresaId -> {mapa, vence}
  }

  /** Mapa operador→área/cargo con caché breve (cambia rara vez; evita releerlo en cada evaluación). */
  async _mapa(empresaId) {
    const previo = this._mapaCache.get(empresaId);
    if (previo && previo.vence > this._ahora()) return previo.mapa;
    const mapa = await this._repo.mapaOperadores(empresaId);
    this._mapaCache.set(empresaId, { mapa, vence: this._ahora() + TTL_MAPA_MS });
    return mapa;
  }

  /**
   * @param {{empresaId: string, operadorId: string, fecha: Date|string}} datos
   * @returns {Promise<{publicados: number}>}
   */
  async recalcularTrasEvaluacion({ empresaId, operadorId, fecha }) {
    const dia = fechaLocal(fecha);
    const mapa = await this._mapa(empresaId);
    let publicados = 0;
    for (const ventana of Object.values(ventanas(dia))) {
      publicados += await this._recalcularVentana({ empresaId, operadorId, ventana, mapa });
    }
    return { publicados };
  }

  async _recalcularVentana({ empresaId, operadorId, ventana, mapa }) {
    const { desde, hasta } = ventana;
    const evaluaciones = await this._repo.evaluacionesDeOperador(operadorId, inicioDiaLocalISO(desde), inicioDiaLocalISO(hasta));
    const delOperador = calcularIndicadoresOperador(evaluaciones);
    const filas = delOperador.map((i) => ({ codigo: i.codigo, ambito_id: operadorId, desde, hasta, valor: i.valor, detalle: i.detalle }));
    if (filas.length === 0) return 0; // sin evaluaciones válidas en la ventana: nada que agregar

    let publicados = await this._repo.publicar(empresaId, filas);

    // Agregación de grupo a partir de los valores por operador de la MISMA ventana.
    const guardados = await this._repo.leer({ empresaId, codigos: POR_OPERADOR, desde, hasta, exacto: true });
    const porOperador = new Map();
    for (const g of guardados) {
      const o = porOperador.get(g.ambito_id) ?? { operadorId: g.ambito_id, ...(mapa.get(g.ambito_id) ?? {}) };
      if (g.codigo === C.ICO_TRABAJADOR) o.ico = g.valor;
      else if (g.codigo === C.INDICE_FATIGA) o.fatiga = g.valor;
      else if (g.codigo === C.INDICE_RIESGO) o.riesgo = g.valor;
      porOperador.set(g.ambito_id, o);
    }
    const grupo = calcularIndicadoresGrupo({ empresaId, operadores: [...porOperador.values()] });
    publicados += await this._repo.publicar(
      empresaId,
      grupo.map((i) => ({ codigo: i.codigo, ambito_id: i.ambitoId, desde, hasta, valor: i.valor, detalle: i.detalle })),
    );
    return publicados;
  }
}

export default { IndicadoresService };
