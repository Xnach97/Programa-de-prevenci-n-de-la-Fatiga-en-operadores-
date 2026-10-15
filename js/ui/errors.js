/**
 * @module js/ui/errors
 * @description Traduce cualquier error a un mensaje seguro para la UI. Los
 * errores de validación de dominio ya traen un texto redactado para el usuario;
 * del resto solo se usa el código (nunca el mensaje técnico).
 */

import { t } from '../i18n.js';

/** @param {unknown} error @returns {string} */
export function mensajeSeguro(error) {
  if (error && typeof error === 'object') {
    if (error.codigo === 'validacion' && typeof error.message === 'string') return error.message;
    const codigoPg = error.causaOriginal?.code;
    if (codigoPg === '42501') return t('organization.errors.sin_permiso');
    if (codigoPg === '23505') return t('organization.errors.duplicado');
    if (codigoPg === '23514' || codigoPg === '22P02' || codigoPg === 'P0001') return t('organization.errors.validacion');
  }
  return t('organization.errors.desconocido');
}

/** Contenedor de mensaje con `role` adecuado, listo para rellenar. */
export default { mensajeSeguro };
