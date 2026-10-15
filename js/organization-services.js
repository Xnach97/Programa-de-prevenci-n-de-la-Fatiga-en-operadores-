/**
 * @module js/organization-services
 * @description Composición (inyección de dependencias) de los servicios del
 * módulo Organization y traducción de errores a mensajes para la UI.
 */

import { getDatabase } from './database.js';
import { CatalogosService } from '../services/catalogos-service.js';
import { OperadoresService } from '../services/operadores-service.js';
import { OrganizationError, CODIGOS_ORGANIZATION } from '../services/organization-error.js';
import { t } from './i18n.js';

/** @type {Promise<{catalogos: CatalogosService, operadores: OperadoresService}> | null} */
let serviciosPromise = null;

/** @returns {Promise<{catalogos: CatalogosService, operadores: OperadoresService}>} */
export function getOrganizationServices() {
  if (!serviciosPromise) {
    serviciosPromise = getDatabase()
      .then((db) => ({
        catalogos: new CatalogosService({ catalogos: db.catalogos }),
        operadores: new OperadoresService({ operadores: db.operadores }),
      }))
      .catch((error) => {
        serviciosPromise = null; // permite reintento
        throw error;
      });
  }
  return serviciosPromise;
}

/**
 * Mensaje seguro para el usuario. Un error de validación conserva el detalle
 * (ya redactado para el usuario); el resto usa el texto i18n por código.
 * @param {unknown} error
 * @returns {string}
 */
export function mensajeDeError(error) {
  if (error instanceof OrganizationError) {
    if (error.codigo === CODIGOS_ORGANIZATION.VALIDACION) return error.message;
    return t(`organization.errors.${error.codigo}`);
  }
  return t('organization.errors.desconocido');
}

export default { getOrganizationServices, mensajeDeError };
