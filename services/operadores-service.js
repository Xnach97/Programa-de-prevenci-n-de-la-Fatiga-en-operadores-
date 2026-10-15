/**
 * @module services/operadores-service
 * @description Reglas de negocio de operadores: validación, alta/edición,
 * inactivación y anonimización (Ley 1581, Fase 2 §0.6).
 *
 * La anonimización es IRREVERSIBLE (la garantiza el trigger de BD). Por eso el
 * servicio exige `confirmar === true`: la UI debe pedir confirmación explícita.
 */

import { OrganizationError, CODIGOS_ORGANIZATION as C, traducirErrorDatos } from './organization-error.js';

export const NOMBRE_PERSONA_MAX = 120;
export const TURNO_MAX = 60;
const CEDULA_REGEX = /^\d{5,12}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Campos relacionales opcionales: clave de formulario → columna. */
const RELACIONES = Object.freeze({
  cargoId: 'cargo_id',
  areaId: 'area_id',
  centroTrabajoId: 'centro_trabajo_id',
  lineaOperacionalId: 'linea_operacional_id',
});

function invalido(campo, mensaje) {
  return new OrganizationError(C.VALIDACION, { campo, mensaje });
}

/**
 * Cédula: se admiten puntos, espacios y guiones como separadores visuales.
 * @param {unknown} valor
 * @returns {string} Solo dígitos (5–12).
 */
export function normalizarCedula(valor) {
  const digitos = typeof valor === 'string' || typeof valor === 'number' ? String(valor).replace(/[.\s-]/g, '') : '';
  if (!CEDULA_REGEX.test(digitos)) {
    throw invalido('cedula', 'La cédula debe tener entre 5 y 12 dígitos.');
  }
  return digitos;
}

function textoRequerido(valor, campo, etiqueta, max) {
  const limpio = typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
  if (!limpio) throw invalido(campo, `${etiqueta} es obligatorio.`);
  if (limpio.length > max) throw invalido(campo, `${etiqueta} no puede superar ${max} caracteres.`);
  return limpio;
}

function textoOpcional(valor, campo, etiqueta, max) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  return textoRequerido(String(valor), campo, etiqueta, max);
}

function relacionOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) throw invalido(campo, 'Selección no válida.');
  return valor;
}

/**
 * Valida el formulario de operador y lo convierte a columnas de BD.
 * @param {Record<string, unknown>} formulario
 * @returns {object} Columnas snake_case (sin empresa_id).
 * @throws {OrganizationError}
 */
export function validarOperador(formulario) {
  const datos = {
    cedula: normalizarCedula(formulario?.cedula),
    nombre: textoRequerido(formulario?.nombre, 'nombre', 'El nombre', NOMBRE_PERSONA_MAX),
    apellido: textoRequerido(formulario?.apellido, 'apellido', 'El apellido', NOMBRE_PERSONA_MAX),
    turno_habitual: textoOpcional(formulario?.turnoHabitual, 'turnoHabitual', 'El turno', TURNO_MAX),
  };
  for (const [clave, columna] of Object.entries(RELACIONES)) {
    datos[columna] = relacionOpcional(formulario?.[clave], clave);
  }
  return datos;
}

export class OperadoresService {
  /** @param {{operadores: import('../js/repositories/operadores-repository.js').OperadoresRepository}} dependencias */
  constructor({ operadores }) {
    if (!operadores) throw new TypeError('OperadoresService requiere el repositorio de operadores.');
    this._repo = operadores;
  }

  /** @private */
  async _ejecutar(operacion) {
    try {
      return await operacion();
    } catch (error) {
      throw traducirErrorDatos(error);
    }
  }

  /** @param {string} empresaId @param {object} [filtros] */
  listar(empresaId, filtros = {}) {
    return this._ejecutar(() => this._repo.listar(empresaId, filtros));
  }

  obtener(id) {
    return this._ejecutar(() => this._repo.obtener(id));
  }

  /**
   * @param {string} empresaId
   * @param {Record<string, unknown>} formulario
   */
  async crear(empresaId, formulario) {
    const datos = validarOperador(formulario);
    return this._ejecutar(() => this._repo.crear({ ...datos, empresa_id: empresaId }));
  }

  /**
   * Edita un operador. La empresa y el estado no se cambian por aquí.
   * @param {string} id
   * @param {Record<string, unknown>} formulario
   */
  async actualizar(id, formulario) {
    const datos = validarOperador(formulario);
    const existente = await this.obtener(id);
    if (!existente) throw new OrganizationError(C.NO_ENCONTRADO);
    if (existente.estado === 'anonimizado') {
      throw new OrganizationError(C.OPERACION_NO_PERMITIDA, {
        mensaje: 'Un operador anonimizado no puede modificarse.',
      });
    }
    return this._ejecutar(() => this._repo.actualizar(id, datos));
  }

  desactivar(id) {
    return this._cambiarEstado(id, 'inactivo');
  }

  activar(id) {
    return this._cambiarEstado(id, 'activo');
  }

  /** @private */
  async _cambiarEstado(id, estado) {
    const existente = await this.obtener(id);
    if (!existente) throw new OrganizationError(C.NO_ENCONTRADO);
    if (existente.estado === 'anonimizado') {
      throw new OrganizationError(C.OPERACION_NO_PERMITIDA, {
        mensaje: 'Un operador anonimizado no puede cambiar de estado.',
      });
    }
    return this._ejecutar(() => this._repo.actualizar(id, { estado }));
  }

  /**
   * Anonimiza (irreversible). Requiere `confirmar === true`.
   * @param {string} id
   * @param {{confirmar?: boolean}} opciones
   */
  async anonimizar(id, { confirmar = false } = {}) {
    if (confirmar !== true) {
      throw new OrganizationError(C.OPERACION_NO_PERMITIDA, {
        mensaje: 'La anonimización es irreversible y requiere confirmación explícita.',
      });
    }
    const existente = await this.obtener(id);
    if (!existente) throw new OrganizationError(C.NO_ENCONTRADO);
    if (existente.estado === 'anonimizado') return { id };
    return this._ejecutar(() => this._repo.actualizar(id, { estado: 'anonimizado' }));
  }
}

export default OperadoresService;
