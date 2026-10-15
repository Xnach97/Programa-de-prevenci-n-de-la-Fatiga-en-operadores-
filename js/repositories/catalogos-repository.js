/**
 * @module js/repositories/catalogos-repository
 * @description Repository de los 5 catálogos organizacionales (Fase 3 §5).
 *
 * Un único repositorio parametrizado por tabla, con LISTA BLANCA: el nombre de
 * tabla nunca proviene del usuario sin pasar por `TABLAS_CATALOGO`, y la
 * columna relacional (cargos→área, líneas→proceso) está fijada aquí.
 */

import { RepositoryError } from './repository-error.js';

/**
 * Definición de cada catálogo. `relacion` describe el padre opcional.
 * @type {Readonly<Record<string, {tabla: string, relacion: {columna: string, tabla: string} | null}>>}
 */
export const TABLAS_CATALOGO = Object.freeze({
  areas: Object.freeze({ tabla: 'areas', relacion: null }),
  procesos: Object.freeze({ tabla: 'procesos', relacion: null }),
  centros_trabajo: Object.freeze({ tabla: 'centros_trabajo', relacion: null }),
  cargos: Object.freeze({ tabla: 'cargos', relacion: Object.freeze({ columna: 'area_id', tabla: 'areas' }) }),
  lineas_operacionales: Object.freeze({
    tabla: 'lineas_operacionales',
    relacion: Object.freeze({ columna: 'proceso_id', tabla: 'procesos' }),
  }),
});

export const ESTADOS_CATALOGO = Object.freeze(['activo', 'inactivo', 'archivado']);

export class CatalogosRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new TypeError('CatalogosRepository requiere una instancia de cliente Supabase.');
    }
    this._client = supabaseClient;
  }

  /** @private */
  _definicion(catalogo) {
    const definicion = Object.hasOwn(TABLAS_CATALOGO, catalogo) ? TABLAS_CATALOGO[catalogo] : null;
    if (!definicion) throw new RangeError(`Catálogo desconocido: ${String(catalogo)}`);
    return definicion;
  }

  /**
   * @param {string} catalogo
   * @param {string} empresaId
   * @param {{incluirInactivos?: boolean}} [opciones]
   * @returns {Promise<object[]>} Ordenados por nombre.
   */
  async listar(catalogo, empresaId, { incluirInactivos = true } = {}) {
    const { tabla, relacion } = this._definicion(catalogo);
    const columnas = ['id', 'empresa_id', 'nombre', 'estado', relacion?.columna].filter(Boolean).join(', ');
    let consulta = this._client.from(tabla).select(columnas).eq('empresa_id', empresaId).order('nombre');
    if (!incluirInactivos) consulta = consulta.eq('estado', 'activo');
    const { data, error } = await consulta;
    if (error) throw new RepositoryError(`catalogos.listar.${catalogo}`, error);
    return data ?? [];
  }

  /**
   * @param {string} catalogo
   * @param {{empresaId: string, nombre: string, padreId?: string|null}} datos
   * @returns {Promise<object>}
   */
  async crear(catalogo, { empresaId, nombre, padreId = null }) {
    const { tabla, relacion } = this._definicion(catalogo);
    const fila = { empresa_id: empresaId, nombre };
    if (relacion) fila[relacion.columna] = padreId;
    const { data, error } = await this._client.from(tabla).insert(fila).select().single();
    if (error) throw new RepositoryError(`catalogos.crear.${catalogo}`, error);
    return data;
  }

  /**
   * @param {string} catalogo
   * @param {string} id
   * @param {{nombre?: string, estado?: string, padreId?: string|null}} cambios
   * @returns {Promise<object>}
   */
  async actualizar(catalogo, id, { nombre, estado, padreId } = {}) {
    const { tabla, relacion } = this._definicion(catalogo);
    const cambios = {};
    if (nombre !== undefined) cambios.nombre = nombre;
    if (estado !== undefined) cambios.estado = estado;
    if (padreId !== undefined && relacion) cambios[relacion.columna] = padreId;
    const { data, error } = await this._client.from(tabla).update(cambios).eq('id', id).select().single();
    if (error) throw new RepositoryError(`catalogos.actualizar.${catalogo}`, error);
    return data;
  }
}

export default CatalogosRepository;
