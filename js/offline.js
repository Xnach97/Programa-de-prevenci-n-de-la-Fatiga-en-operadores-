/**
 * @module js/offline
 * @description Composición del Offline Engine (Módulo 9): almacenes IndexedDB,
 * cola de evaluaciones, caché de lectura y el post-registro (indicadores + reglas)
 * que corre tras CADA envío real, ya sea inmediato o diferido.
 */

import { getDatabase } from './database.js';
import { OfflineQueue } from '../services/offline-queue.js';
import { getAlmacenes, purgarCache } from './offline-storage.js';
import { IndicadoresService } from '../services/indicadores-service.js';
import { ReglasService } from '../services/reglas-service.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('offline');

export { getAlmacenes, purgarCache };

/**
 * Recálculo de indicadores y reglas tras guardar una evaluación.
 * Los indicadores alimentan las reglas, pero el fallo de uno no anula al otro.
 * @param {{empresaId: string, operadorId: string, fecha: string, payload: object, codigosPorVersion: object, contexto?: object}} datos
 */
export async function postRegistro(datos) {
  const db = await getDatabase();
  const indicadores = new IndicadoresService({ indicadores: db.indicadores });
  const reglas = new ReglasService({ reglas: db.reglas });
  let valoresDia = {};
  try {
    ({ valoresDia } = await indicadores.recalcularTrasEvaluacion(datos));
  } catch (error) {
    logger.warn('Indicadores no recalculados', { error: String(error) });
  }
  await reglas.evaluarTrasEvaluacion({
    empresaId: datos.empresaId,
    operadorId: datos.operadorId,
    operadorNombre: datos.contexto?.operadorNombre ?? null,
    payload: datos.payload,
    codigosPorVersion: datos.codigosPorVersion,
    indicadoresDia: valoresDia,
  });
}

let colaPromise = null;
/** @returns {Promise<OfflineQueue>} Cola única de la aplicación. */
export function getCola() {
  if (!colaPromise) {
    colaPromise = getDatabase().then((db) =>
      new OfflineQueue({
        almacen: getAlmacenes().cola,
        enviar: (payload) => db.testing.registrar(payload),
        alSincronizado: (item) =>
          postRegistro({
            empresaId: item.payload.empresa_id,
            operadorId: item.payload.operador_id,
            fecha: item.payload.fecha,
            payload: item.payload,
            codigosPorVersion: item.contexto?.codigosPorVersion ?? {},
            contexto: item.contexto,
          }),
        // Candado entre pestañas: solo una sincroniza a la vez (el servidor igual es idempotente).
        conCandado: globalThis.navigator?.locks
          ? (fn) => navigator.locks.request('neurolab-sync', { ifAvailable: true }, (candado) => (candado ? fn() : null))
          : null,
      }),
    );
    colaPromise.catch(() => { colaPromise = null; });
  }
  return colaPromise;
}

export default { getAlmacenes, getCola, postRegistro, purgarCache };
