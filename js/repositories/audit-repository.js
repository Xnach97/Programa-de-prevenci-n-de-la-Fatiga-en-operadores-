/**
 * @module js/repositories/audit-repository
 * @description Lectura de `auditoria` y registro de acciones sin tabla propia.
 * La tabla es append-only: no existe método de modificación ni borrado.
 */

import { RepositoryError } from './repository-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exigirUuid = (v, n) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new TypeError(`${n} debe ser un UUID.`);
  return v;
};
export const TAMANO_PAGINA_AUDITORIA = 25;

export class AuditRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('AuditRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
  }

  /** @returns {Promise<{filas: object[], total: number}>} */
  async listar(empresaId, { pagina = 0, entidad = null } = {}) {
    const id = exigirUuid(empresaId, 'empresaId');
    const desde = Math.max(Math.trunc(pagina) || 0, 0) * TAMANO_PAGINA_AUDITORIA;
    let q = this._client
      .from('auditoria')
      .select('id, usuario_id, accion, entidad, entidad_id, detalle_anterior, detalle_nuevo, ip, created_at', { count: 'exact' })
      .eq('empresa_id', id)
      .order('created_at', { ascending: false })
      .range(desde, desde + TAMANO_PAGINA_AUDITORIA - 1);
    if (entidad) q = q.eq('entidad', entidad);
    const { data, error, count } = await q;
    if (error) throw new RepositoryError('auditoria.listar', error);
    return { filas: data ?? [], total: count ?? 0 };
  }

  /** @returns {Promise<string>} Id del registro. */
  async registrar({ empresaId, accion, entidad, entidadId = null, detalle = null }) {
    const { data, error } = await this._client.rpc('registrar_auditoria', {
      p_empresa: exigirUuid(empresaId, 'empresaId'),
      p_accion: accion,
      p_entidad: entidad,
      p_entidad_id: entidadId === null ? null : exigirUuid(entidadId, 'entidadId'),
      p_detalle: detalle,
    });
    if (error) throw new RepositoryError('auditoria.registrar', error);
    return data;
  }
}

export default AuditRepository;
