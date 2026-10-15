/**
 * @module services/organization-error
 * @description Errores de dominio del módulo Organization y traducción de los
 * errores crudos de la capa de datos (códigos SQLSTATE / PostgREST).
 *
 * La UI decide el texto con `codigo` (i18n); `message` es un respaldo en español
 * seguro de mostrar, sin detalle interno de la base de datos.
 */

export const CODIGOS_ORGANIZATION = Object.freeze({
  VALIDACION: 'validacion',
  DUPLICADO: 'duplicado',
  REFERENCIA_INVALIDA: 'referencia_invalida',
  NO_ENCONTRADO: 'no_encontrado',
  SIN_PERMISO: 'sin_permiso',
  OPERACION_NO_PERMITIDA: 'operacion_no_permitida',
  DESCONOCIDO: 'desconocido',
});

const MENSAJES = Object.freeze({
  validacion: 'Los datos ingresados no son válidos.',
  duplicado: 'Ya existe un registro con ese nombre o cédula.',
  referencia_invalida: 'La referencia seleccionada no es válida para esta empresa.',
  no_encontrado: 'El registro no existe o no tiene permiso para modificarlo.',
  sin_permiso: 'No tiene permiso para realizar esta acción.',
  operacion_no_permitida: 'Esta operación no está permitida.',
  desconocido: 'No fue posible completar la operación. Intente de nuevo.',
});

export class OrganizationError extends Error {
  /**
   * @param {string} codigo Uno de CODIGOS_ORGANIZATION.
   * @param {{campo?: string, mensaje?: string, causaOriginal?: unknown}} [detalle]
   */
  constructor(codigo, { campo = null, mensaje = null, causaOriginal = null } = {}) {
    super(mensaje ?? MENSAJES[codigo] ?? MENSAJES.desconocido);
    this.name = 'OrganizationError';
    this.codigo = codigo;
    this.campo = campo;
    this.causaOriginal = causaOriginal;
  }
}

/**
 * Convierte cualquier error de la capa de datos en OrganizationError.
 * Los OrganizationError pasan sin cambios.
 * @param {unknown} error
 * @returns {OrganizationError}
 */
export function traducirErrorDatos(error) {
  if (error instanceof OrganizationError) return error;
  const causa = error && typeof error === 'object' && 'causaOriginal' in error ? error.causaOriginal : error;
  const sqlstate = causa && typeof causa === 'object' && 'code' in causa ? String(causa.code) : '';

  const codigo =
    {
      '23505': CODIGOS_ORGANIZATION.DUPLICADO,
      '23503': CODIGOS_ORGANIZATION.REFERENCIA_INVALIDA,
      '23514': CODIGOS_ORGANIZATION.OPERACION_NO_PERMITIDA,
      '42501': CODIGOS_ORGANIZATION.SIN_PERMISO,
      PGRST116: CODIGOS_ORGANIZATION.NO_ENCONTRADO,
    }[sqlstate] ?? CODIGOS_ORGANIZATION.DESCONOCIDO;

  return new OrganizationError(codigo, { causaOriginal: error });
}

export default { OrganizationError, CODIGOS_ORGANIZATION, traducirErrorDatos };
