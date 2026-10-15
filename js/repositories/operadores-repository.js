/**
 * @module js/repositories/operadores-repository
 * @description Repository de la tabla `operadores` (Fase 3 §5).
 *
 * Sin método de borrado: los operadores se inactivan o se anonimizan.
 */

import { RepositoryError } from './repository-error.js';

const COLUMNAS_LISTA =
  'id, empresa_id, usuario_id, cedula, nombre, apellido, estado, turno_habitual, cargo_id, area_id, centro_trabajo_id, linea_operacional_id, ' +
  'cargo:cargos(nombre), area:areas(nombre), centro_trabajo:centros_trabajo(nombre), linea_operacional:lineas_operacionales(nombre)';

export const TAMANO_PAGINA_DEFECTO = 25;
export const TAMANO_PAGINA_MAXIMO = 100;

/**
 * Deja solo caracteres seguros para un término ingresado en un filtro
 * `.or(... ilike ...)` de PostgREST. Se eliminan los separadores de la
 * gramática del filtro (`,` `(` `)` `.` `:` `"` `\`) y los comodines de LIKE
 * (`%` `_` `*`), de modo que el texto del usuario no pueda añadir condiciones.
 * @param {unknown} termino
 * @returns {string}
 */
export function sanitizarTerminoBusqueda(termino) {
  if (typeof termino !== 'string') return '';
  return termino
    .replace(/[,().:"\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OperadoresRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new TypeError('OperadoresRepository requiere una instancia de cliente Supabase.');
    }
    this._client = supabaseClient;
  }

  /**
   * @param {string} empresaId
   * @param {{busqueda?: string, estado?: string|null, pagina?: number, tamano?: number}} [filtros]
   * @returns {Promise<{filas: object[], total: number}>}
   */
  async listar(empresaId, { busqueda = '', estado = null, pagina = 0, tamano = TAMANO_PAGINA_DEFECTO } = {}) {
    const limite = Math.min(Math.max(Math.trunc(tamano) || TAMANO_PAGINA_DEFECTO, 1), TAMANO_PAGINA_MAXIMO);
    const desde = Math.max(Math.trunc(pagina) || 0, 0) * limite;

    let consulta = this._client
      .from('operadores')
      .select(COLUMNAS_LISTA, { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('apellido', { nullsFirst: false })
      .order('nombre', { nullsFirst: false })
      .range(desde, desde + limite - 1);

    if (estado) consulta = consulta.eq('estado', estado);

    const termino = sanitizarTerminoBusqueda(busqueda);
    if (termino) {
      consulta = consulta.or(`cedula.ilike.%${termino}%,nombre.ilike.%${termino}%,apellido.ilike.%${termino}%`);
    }

    const { data, error, count } = await consulta;
    if (error) throw new RepositoryError('operadores.listar', error);
    return { filas: data ?? [], total: count ?? 0 };
  }

  /**
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async obtener(id) {
    const { data, error } = await this._client.from('operadores').select(COLUMNAS_LISTA).eq('id', id).maybeSingle();
    if (error) throw new RepositoryError('operadores.obtener', error);
    return data;
  }

  /**
   * Operador vinculado a una cuenta de usuario (el propio operador).
   * @param {string} usuarioId
   * @returns {Promise<object|null>}
   */
  async obtenerPorUsuario(usuarioId) {
    if (typeof usuarioId !== 'string' || !UUID.test(usuarioId)) throw new TypeError('usuarioId debe ser un UUID.');
    const { data, error } = await this._client
      .from('operadores')
      .select(COLUMNAS_LISTA)
      .eq('usuario_id', usuarioId)
      .eq('estado', 'activo')
      .maybeSingle();
    if (error) throw new RepositoryError('operadores.obtenerPorUsuario', error);
    return data;
  }

  /**
   * Operador ACTIVO por cédula exacta dentro de la empresa (modo quiosco).
   * @param {string} empresaId
   * @param {string} cedula
   * @returns {Promise<object|null>}
   */
  async obtenerActivoPorCedula(empresaId, cedula) {
    if (typeof empresaId !== 'string' || !UUID.test(empresaId)) throw new TypeError('empresaId debe ser un UUID.');
    const limpia = typeof cedula === 'string' ? cedula.trim().slice(0, 40) : '';
    if (!limpia) return null;
    const { data, error } = await this._client
      .from('operadores')
      .select(COLUMNAS_LISTA)
      .eq('empresa_id', empresaId)
      .eq('cedula', limpia)
      .eq('estado', 'activo')
      .maybeSingle();
    if (error) throw new RepositoryError('operadores.obtenerActivoPorCedula', error);
    return data;
  }

  /**
   * @param {object} datos Columnas de `operadores` (snake_case) ya validadas.
   * @returns {Promise<object>}
   */
  async crear(datos) {
    const { data, error } = await this._client.from('operadores').insert(datos).select('id').single();
    if (error) throw new RepositoryError('operadores.crear', error);
    return data;
  }

  /**
   * @param {string} id
   * @param {object} cambios Columnas de `operadores` (snake_case) ya validadas.
   * @returns {Promise<object>}
   */
  async actualizar(id, cambios) {
    const { data, error } = await this._client.from('operadores').update(cambios).eq('id', id).select('id').single();
    if (error) throw new RepositoryError('operadores.actualizar', error);
    return data;
  }
}

export default OperadoresRepository;
