/**
 * @module js/repositories/testing-repository
 * @description Repository del catálogo de pruebas y del registro de
 * evaluaciones (Fase 3 §6). El alta de una evaluación y sus resultados es
 * ATÓMICA e idempotente: pasa por la función SQL `registrar_evaluacion`.
 */

import { RepositoryError } from './repository-error.js';

const COLUMNAS_PRUEBA =
  'id, codigo, nombre, categoria, estado, version_actual:pruebas_versiones!fk_version_actual(id, numero_version, parametros, funcion_puntuacion, estado)';

export class TestingRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('TestingRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
  }

  /**
   * Pruebas activas con su versión vigente.
   * @returns {Promise<object[]>}
   */
  async listarActivas() {
    const { data, error } = await this._client.from('pruebas').select(COLUMNAS_PRUEBA).eq('estado', 'activa').order('codigo');
    if (error) throw new RepositoryError('pruebas.listarActivas', error);
    return data ?? [];
  }

  /**
   * @param {object} payload Contrato de `registrar_evaluacion` (ver 0010).
   * @returns {Promise<{evaluacion_id: string, duplicada: boolean}>}
   */
  async registrar(payload) {
    const { data, error } = await this._client.rpc('registrar_evaluacion', { p: payload });
    if (error) throw new RepositoryError('evaluaciones.registrar', error);
    return data;
  }

  /**
   * Historial de ICO de la empresa (insumo del baremo dinámico).
   * Solo evaluaciones con ICO calculado, dentro de la ventana.
   * @param {string} empresaId
   * @param {Date} desde
   * @param {Date} hasta
   * @returns {Promise<Array<{valor: number, fecha: string}>>}
   */
  async historialIco(empresaId, desde, hasta) {
    const { data, error } = await this._client
      .from('evaluaciones')
      .select('ico_valor, fecha')
      .eq('empresa_id', empresaId)
      .gte('fecha', desde.toISOString())
      .lte('fecha', hasta.toISOString())
      .not('ico_valor', 'is', null)
      .limit(5000);
    if (error) throw new RepositoryError('evaluaciones.historialIco', error);
    return (data ?? []).map((f) => ({ valor: Number(f.ico_valor), fecha: f.fecha }));
  }
}

export default TestingRepository;
