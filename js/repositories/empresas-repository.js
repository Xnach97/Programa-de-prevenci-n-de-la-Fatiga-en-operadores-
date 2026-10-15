/**
 * @module js/repositories/empresas-repository
 * @description Repository de las tablas `empresas` y `configuracion_empresa`.
 *
 * Fuente de datos que `theming.js` necesita para aplicar la marca real de la
 * empresa activa (Fase 2 §3).
 */

import { RepositoryError } from './repository-error.js';

export class EmpresasRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new TypeError('EmpresasRepository requiere una instancia de cliente Supabase.');
    }
    this._client = supabaseClient;
  }

  /**
   * @param {string} empresaId
   * @returns {Promise<{id: string, nombre: string, nit: string, plan: string, estado: string} | null>}
   */
  async obtenerEmpresa(empresaId) {
    const { data, error } = await this._client
      .from('empresas')
      .select('id, nombre, nit, plan, estado')
      .eq('id', empresaId)
      .maybeSingle();

    if (error) throw new RepositoryError('empresas.obtenerEmpresa', error);
    return data;
  }

  /**
   * Configuración de negocio de una empresa (Fase 3 §4): marca, turnos,
   * pruebas activas, feature flags, modalidad de baremo.
   * @param {string} empresaId
   * @returns {Promise<object | null>}
   */
  async obtenerConfiguracion(empresaId) {
    const { data, error } = await this._client
      .from('configuracion_empresa')
      .select('empresa_id, marca, turnos, pruebas_activas, feature_flags, baremo_modalidad')
      .eq('empresa_id', empresaId)
      .maybeSingle();

    if (error) throw new RepositoryError('empresas.obtenerConfiguracion', error);
    return data;
  }

  /**
   * Actualiza la configuración de negocio (RLS: `configuracion.editar`).
   * @param {string} empresaId
   * @param {{marca?: object, turnos?: object[], pruebas_activas?: string[], baremo_modalidad?: string}} cambios ya validados
   * @param {string|null} usuarioId
   * @returns {Promise<object>}
   */
  async actualizarConfiguracion(empresaId, cambios, usuarioId = null) {
    const { data, error } = await this._client
      .from('configuracion_empresa')
      .update({ ...cambios, updated_at: new Date().toISOString(), updated_by: usuarioId })
      .eq('empresa_id', empresaId)
      .select('empresa_id')
      .single();
    if (error) throw new RepositoryError('empresas.actualizarConfiguracion', error);
    return data;
  }
}

export default EmpresasRepository;
