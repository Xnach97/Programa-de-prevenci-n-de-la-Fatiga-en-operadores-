/**
 * @module js/repositories/usuarios-repository
 * @description Repository de la tabla `usuarios` y su relación con roles/permisos.
 *
 * Repository Pattern: encapsula la forma de las consultas Supabase del
 * agregado "usuario", de modo que `services/auth-service.js` nunca construye
 * un `.from('usuarios')` por su cuenta.
 */

import { RepositoryError } from './repository-error.js';

export class UsuariosRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new TypeError('UsuariosRepository requiere una instancia de cliente Supabase.');
    }
    this._client = supabaseClient;
  }

  /**
   * Perfil de aplicación de un usuario autenticado, o `null` si aún no tiene
   * fila en `usuarios` (estado transitorio durante onboarding).
   * @param {string} usuarioId - UUID de auth.users.id.
   * @returns {Promise<{id: string, empresa_id: string|null, nombre_completo: string, email: string, estado: string} | null>}
   */
  async obtenerPerfilCompleto(usuarioId) {
    const { data, error } = await this._client
      .from('usuarios')
      .select('id, empresa_id, nombre_completo, email, estado')
      .eq('id', usuarioId)
      .maybeSingle();

    if (error) throw new RepositoryError('usuarios.obtenerPerfilCompleto', error);
    return data;
  }

  /**
   * Asignaciones de rol por empresa con permisos incluidos (un solo `select`
   * anidado, sin N+1). Fuente de datos de `normalizarAsignaciones`.
   * @param {string} usuarioId
   * @returns {Promise<Array<object>>}
   */
  async listarRolesYPermisosDelUsuario(usuarioId) {
    const { data, error } = await this._client
      .from('usuarios_roles')
      .select('empresa_id, empresas(nombre), roles(id, nombre, roles_permisos(permisos(codigo)))')
      .eq('usuario_id', usuarioId);

    if (error) throw new RepositoryError('usuarios.listarRolesYPermisosDelUsuario', error);
    return data ?? [];
  }

  /**
   * Usuarios de una empresa. La visibilidad real la decide RLS (migración
   * 0002, permiso `usuarios.ver`).
   * @param {string} empresaId
   * @returns {Promise<Array<{id: string, nombre_completo: string, email: string, estado: string}>>}
   */
  async listarPorEmpresa(empresaId) {
    const { data, error } = await this._client
      .from('usuarios')
      .select('id, nombre_completo, email, estado')
      .eq('empresa_id', empresaId)
      .order('nombre_completo', { ascending: true });

    if (error) throw new RepositoryError('usuarios.listarPorEmpresa', error);
    return data ?? [];
  }
}

export default UsuariosRepository;
