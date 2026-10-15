/**
 * @module js/repositories/indicadores-repository
 * @description Acceso a `indicadores_definiciones` / `indicadores_valores` y a
 * los datos de origen que necesita el recálculo. Los dashboards leen SOLO con
 * `leer()`; nunca agregan sobre `resultados_pruebas`.
 */

import { RepositoryError } from './repository-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const exigirUuid = (v, n) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new TypeError(`${n} debe ser un UUID.`);
  return v;
};
const exigirFecha = (v, n) => {
  if (typeof v !== 'string' || !FECHA.test(v)) throw new TypeError(`${n} debe ser YYYY-MM-DD.`);
  return v;
};
const PAGINA = 1000;

/** Rango canónico de PostgreSQL para `daterange` con límites `[)`. */
const rango = (desde, hasta) => `[${exigirFecha(desde, 'desde')},${exigirFecha(hasta, 'hasta')})`;

export class IndicadoresRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('IndicadoresRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
    /** @type {Promise<Map<string, {id: string, codigo: string, ambito: string}>>|null} */
    this._definiciones = null;
  }

  /** @returns {Promise<Map<string, {id: string, codigo: string, ambito: string}>>} por código. */
  listarDefiniciones() {
    if (!this._definiciones) {
      this._definiciones = this._client
        .from('indicadores_definiciones')
        .select('id, codigo, nombre, ambito, formula_ref')
        .then(({ data, error }) => {
          if (error) throw new RepositoryError('indicadores.listarDefiniciones', error);
          return new Map((data ?? []).map((d) => [d.codigo, d]));
        })
        .catch((error) => {
          this._definiciones = null;
          throw error;
        });
    }
    return this._definiciones;
  }

  /**
   * Evaluaciones de un operador en [desdeISO, hastaISO) con la categoría de cada prueba.
   * @returns {Promise<Array<{ico_valor: number|null, ico_nivel: string|null, estado: string, resultados: Array<{categoria: string, puntaje: number|null, valido: boolean}>}>>}
   */
  async evaluacionesDeOperador(operadorId, desdeISO, hastaISO) {
    const id = exigirUuid(operadorId, 'operadorId');
    const { data, error } = await this._client
      .from('evaluaciones')
      .select(
        'id, fecha, ico_valor, ico_nivel, estado, ' +
          'resultados:resultados_pruebas(es_valido_para_analisis, puntaje_normalizado, prueba_version:pruebas_versiones(prueba:pruebas!pruebas_versiones_prueba_id_fkey(categoria)))',
      )
      .eq('operador_id', id)
      .gte('fecha', desdeISO)
      .lt('fecha', hastaISO)
      .limit(2000);
    if (error) throw new RepositoryError('indicadores.evaluacionesDeOperador', error);
    return (data ?? []).map((e) => ({
      id: e.id,
      ico_valor: e.ico_valor === null ? null : Number(e.ico_valor),
      ico_nivel: e.ico_nivel,
      estado: e.estado,
      resultados: (e.resultados ?? []).map((r) => ({
        categoria: r.prueba_version?.prueba?.categoria ?? null,
        puntaje: r.puntaje_normalizado === null ? null : Number(r.puntaje_normalizado),
        valido: r.es_valido_para_analisis === true,
      })),
    }));
  }

  /** Mapa operador → área/cargo de la empresa (paginado). */
  async mapaOperadores(empresaId) {
    const id = exigirUuid(empresaId, 'empresaId');
    const filas = [];
    for (let desde = 0; ; desde += PAGINA) {
      const { data, error } = await this._client
        .from('operadores')
        .select('id, area_id, cargo_id')
        .eq('empresa_id', id)
        .range(desde, desde + PAGINA - 1);
      if (error) throw new RepositoryError('indicadores.mapaOperadores', error);
      filas.push(...(data ?? []));
      if ((data ?? []).length < PAGINA) break;
    }
    return new Map(filas.map((f) => [f.id, { areaId: f.area_id, cargoId: f.cargo_id }]));
  }

  /**
   * Lectura única de dashboards.
   * @param {{empresaId: string, codigos: string[], desde: string, hasta: string, ambitoId?: string}} filtro
   *   Periodo EXACTO [desde, hasta) cuando `exacto`; si no, todos los periodos contenidos en él.
   * @returns {Promise<Array<{codigo: string, ambito_id: string, desde: string, hasta: string, valor: number, detalle: object}>>}
   */
  async leer({ empresaId, codigos, desde, hasta, ambitoId = null, exacto = false }) {
    const id = exigirUuid(empresaId, 'empresaId');
    const definiciones = await this.listarDefiniciones();
    const porId = new Map();
    for (const codigo of codigos) {
      const d = definiciones.get(codigo);
      if (d) porId.set(d.id, codigo);
    }
    if (porId.size === 0) return [];
    let consulta = this._client
      .from('indicadores_valores')
      .select('indicador_id, ambito_id, periodo, valor, detalle, calculado_en')
      .eq('empresa_id', id)
      .in('indicador_id', [...porId.keys()])
      .order('calculado_en', { ascending: false })
      .limit(5000);
    // Exacto: igualdad de rango. Si no: periodos CONTENIDOS en [desde, hasta) (operador `<@`).
    consulta = exacto ? consulta.eq('periodo', rango(desde, hasta)) : consulta.containedBy('periodo', rango(desde, hasta));
    if (ambitoId) consulta = consulta.eq('ambito_id', exigirUuid(ambitoId, 'ambitoId'));
    const { data, error } = await consulta;
    if (error) throw new RepositoryError('indicadores.leer', error);
    return (data ?? []).map((f) => {
      const [d, h] = String(f.periodo).replace(/[[\]()"]/g, '').split(',');
      return { codigo: porId.get(f.indicador_id), ambito_id: f.ambito_id, desde: d, hasta: h, valor: Number(f.valor), detalle: f.detalle ?? {}, calculado_en: f.calculado_en };
    });
  }

  /**
   * @param {string} empresaId
   * @param {Array<{codigo: string, ambito_id: string, desde: string, hasta: string, valor: number, detalle?: object}>} valores
   * @returns {Promise<number>} Cantidad publicada.
   */
  async publicar(empresaId, valores) {
    if (!Array.isArray(valores) || valores.length === 0) return 0;
    const { data, error } = await this._client.rpc('publicar_indicadores', { p_empresa: exigirUuid(empresaId, 'empresaId'), p_valores: valores });
    if (error) throw new RepositoryError('indicadores.publicar', error);
    return data;
  }
}

export default IndicadoresRepository;
