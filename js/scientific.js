/**
 * @module js/scientific
 * @description Composición (inyección de dependencias) del Scientific Engine
 * para el resto de la aplicación. El Testing Engine (Módulo 5) consume
 * `getScientificServices()`; no instancia repositorios por su cuenta.
 */

import { getDatabase } from './database.js';
import { ScientificService, ConfiguracionCientificaService } from '../services/scientific-service.js';

/** @type {Promise<{motor: ScientificService, configuracion: ConfiguracionCientificaService}> | null} */
let serviciosPromise = null;

/**
 * @param {{obtenerHistorialIco?: Function}} [opciones] Solo se usa en la PRIMERA llamada.
 * @returns {Promise<{motor: ScientificService, configuracion: ConfiguracionCientificaService}>}
 */
export function getScientificServices({ obtenerHistorialIco } = {}) {
  if (!serviciosPromise) {
    serviciosPromise = getDatabase()
      .then((db) => ({
        motor: new ScientificService({
          ico: db.ico,
          baremos: db.baremos,
          obtenerModalidad: async (empresaId) => {
            const configuracion = await db.empresas.obtenerConfiguracion(empresaId);
            return configuracion?.baremo_modalidad ?? 'dinamico';
          },
          obtenerHistorialIco:
            obtenerHistorialIco ??
            (({ empresaId, fecha, ventanaDias }) =>
              db.testing.historialIco(empresaId, new Date(fecha.getTime() - ventanaDias * 86400000), fecha)),
        }),
        configuracion: new ConfiguracionCientificaService({ ico: db.ico, baremos: db.baremos }),
      }))
      .catch((error) => {
        serviciosPromise = null; // permite reintento
        throw error;
      });
  }
  return serviciosPromise;
}

export default { getScientificServices };
