/**
 * @module js/repositories/scientific-repository
 * @description Repositories de `ico_configuraciones` y `baremos` (Fase 3 §7).
 * Las versiones se publican con las funciones SQL atómicas
 * `publicar_ico_configuracion` / `publicar_baremo` (cierran la vigente e
 * insertan la nueva en una sola transacción); nunca se hace UPDATE/DELETE
 * desde JS.
 */

import { RepositoryError } from './repository-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id que se interpola en un filtro PostgREST debe ser un UUID: nada más. */
function exigirUuid(valor, nombre) {
  if (typeof valor !== 'string' || !UUID.test(valor)) throw new TypeError(`${nombre} debe ser un UUID.`);
  return valor;
}

export class IcoConfiguracionesRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('IcoConfiguracionesRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
  }

  /**
   * Todas las versiones de pesos de la empresa (vigentes e históricas).
   * @param {string} empresaId
   * @returns {Promise<object[]>}
   */
  async listar(empresaId) {
    const id = exigirUuid(empresaId, 'empresaId'); // validar ANTES de tocar el cliente
    const { data, error } = await this._client
      .from('ico_configuraciones')
      .select('id, empresa_id, cargo_id, pesos, vigente_desde, vigente_hasta')
      .eq('empresa_id', id)
      .order('vigente_desde', { ascending: false });
    if (error) throw new RepositoryError('ico.listar', error);
    return data ?? [];
  }

  /**
   * @param {{empresaId: string, cargoId?: string|null, pesos: Record<string, number>}} datos
   * @returns {Promise<string>} Id de la versión creada.
   */
  async publicar({ empresaId, cargoId = null, pesos }) {
    const { data, error } = await this._client.rpc('publicar_ico_configuracion', {
      p_empresa_id: exigirUuid(empresaId, 'empresaId'),
      p_cargo_id: cargoId === null ? null : exigirUuid(cargoId, 'cargoId'),
      p_pesos: pesos,
    });
    if (error) throw new RepositoryError('ico.publicar', error);
    return data;
  }
}

export class BaremosRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('BaremosRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
  }

  /**
   * Baremos de la empresa MÁS los científicos globales (empresa_id nulo).
   * @param {string} empresaId
   * @returns {Promise<object[]>}
   */
  async listar(empresaId) {
    const id = exigirUuid(empresaId, 'empresaId');
    const { data, error } = await this._client
      .from('baremos')
      .select('id, empresa_id, prueba_id, modalidad, parametros, fuente, vigente_desde, vigente_hasta')
      .or(`empresa_id.eq.${id},empresa_id.is.null`)
      .order('vigente_desde', { ascending: false });
    if (error) throw new RepositoryError('baremos.listar', error);
    return data ?? [];
  }

  /**
   * @param {{empresaId: string|null, pruebaId?: string|null, modalidad: string, parametros: object, fuente?: string|null}} datos
   * @returns {Promise<string>} Id de la versión creada.
   */
  async publicar({ empresaId, pruebaId = null, modalidad, parametros, fuente = null }) {
    const { data, error } = await this._client.rpc('publicar_baremo', {
      p_empresa_id: empresaId === null ? null : exigirUuid(empresaId, 'empresaId'),
      p_prueba_id: pruebaId === null ? null : exigirUuid(pruebaId, 'pruebaId'),
      p_modalidad: modalidad,
      p_parametros: parametros,
      p_fuente: fuente,
    });
    if (error) throw new RepositoryError('baremos.publicar', error);
    return data;
  }
}

export default { IcoConfiguracionesRepository, BaremosRepository };
