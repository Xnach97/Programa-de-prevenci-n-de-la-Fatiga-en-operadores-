/**
 * @module services/catalogos-service
 * @description Reglas de negocio de los catálogos organizacionales
 * (áreas, procesos, centros de trabajo, cargos, líneas operacionales).
 *
 * El repositorio se inyecta por constructor (testeable sin red). Los permisos
 * efectivos los aplica RLS; la UI además oculta lo que el usuario no puede hacer.
 */

import { OrganizationError, CODIGOS_ORGANIZATION as C, traducirErrorDatos } from './organization-error.js';
import { TABLAS_CATALOGO, ESTADOS_CATALOGO } from '../js/repositories/catalogos-repository.js';

export const NOMBRE_MAX = 120;

/**
 * Normaliza y valida un nombre de catálogo: recorta y colapsa espacios.
 * @param {unknown} nombre
 * @returns {string}
 * @throws {OrganizationError}
 */
export function normalizarNombre(nombre) {
  const limpio = typeof nombre === 'string' ? nombre.replace(/\s+/g, ' ').trim() : '';
  if (limpio.length === 0) {
    throw new OrganizationError(C.VALIDACION, { campo: 'nombre', mensaje: 'El nombre es obligatorio.' });
  }
  if (limpio.length > NOMBRE_MAX) {
    throw new OrganizationError(C.VALIDACION, {
      campo: 'nombre',
      mensaje: `El nombre no puede superar ${NOMBRE_MAX} caracteres.`,
    });
  }
  return limpio;
}

export class CatalogosService {
  /** @param {{catalogos: import('../js/repositories/catalogos-repository.js').CatalogosRepository}} dependencias */
  constructor({ catalogos }) {
    if (!catalogos) throw new TypeError('CatalogosService requiere el repositorio de catálogos.');
    this._repo = catalogos;
  }

  /** @returns {string[]} Catálogos soportados. */
  static catalogosDisponibles() {
    return Object.keys(TABLAS_CATALOGO);
  }

  /** @private */
  _exigirCatalogo(catalogo) {
    if (!Object.hasOwn(TABLAS_CATALOGO, catalogo)) {
      throw new OrganizationError(C.VALIDACION, { campo: 'catalogo', mensaje: 'Catálogo desconocido.' });
    }
  }

  /** @private */
  async _ejecutar(operacion) {
    try {
      return await operacion();
    } catch (error) {
      throw traducirErrorDatos(error);
    }
  }

  /**
   * @param {string} catalogo
   * @param {string} empresaId
   * @param {{soloActivos?: boolean}} [opciones]
   */
  async listar(catalogo, empresaId, { soloActivos = false } = {}) {
    this._exigirCatalogo(catalogo);
    return this._ejecutar(() => this._repo.listar(catalogo, empresaId, { incluirInactivos: !soloActivos }));
  }

  /**
   * @param {string} catalogo
   * @param {string} empresaId
   * @param {{nombre: string, padreId?: string|null}} datos
   */
  async crear(catalogo, empresaId, { nombre, padreId = null }) {
    this._exigirCatalogo(catalogo);
    const nombreLimpio = normalizarNombre(nombre);
    return this._ejecutar(() => this._repo.crear(catalogo, { empresaId, nombre: nombreLimpio, padreId: padreId || null }));
  }

  /**
   * @param {string} catalogo
   * @param {string} id
   * @param {{nombre?: string, estado?: string, padreId?: string|null}} cambios
   */
  async actualizar(catalogo, id, { nombre, estado, padreId } = {}) {
    this._exigirCatalogo(catalogo);
    const cambios = {};
    if (nombre !== undefined) cambios.nombre = normalizarNombre(nombre);
    if (estado !== undefined) {
      if (!ESTADOS_CATALOGO.includes(estado)) {
        throw new OrganizationError(C.VALIDACION, { campo: 'estado', mensaje: 'Estado no válido.' });
      }
      cambios.estado = estado;
    }
    if (padreId !== undefined) cambios.padreId = padreId || null;
    if (Object.keys(cambios).length === 0) {
      throw new OrganizationError(C.VALIDACION, { mensaje: 'No hay cambios que guardar.' });
    }
    return this._ejecutar(() => this._repo.actualizar(catalogo, id, cambios));
  }

  /** Un catálogo en uso no se borra: se desactiva. */
  desactivar(catalogo, id) {
    return this.actualizar(catalogo, id, { estado: 'inactivo' });
  }

  activar(catalogo, id) {
    return this.actualizar(catalogo, id, { estado: 'activo' });
  }
}

export default CatalogosService;
