/**
 * @module js/offline-storage
 * @description Almacenes persistentes del Offline Engine (sin dependencias de la
 * capa de datos, para que `database.js` pueda usarlos sin ciclos de importación).
 */

import { crearAlmacenIndexedDB, crearAlmacenMemoria } from '../services/offline-queue.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('offline-storage');

/** IndexedDB si existe; si no (modo privado antiguo, pruebas) memoria: la app sigue funcionando sin persistencia. */
function almacen(tienda, clave) {
  if (typeof indexedDB === 'undefined') return crearAlmacenMemoria(clave);
  return crearAlmacenIndexedDB({ tienda });
}

let almacenes = null;
export function getAlmacenes() {
  if (!almacenes) almacenes = { cola: almacen('cola', 'id'), cache: almacen('cache', 'clave') };
  return almacenes;
}

/** Borra la caché de lectura (contiene el operador evaluado): se llama al cerrar sesión. */
export async function purgarCache() {
  try {
    await getAlmacenes().cache.clear();
  } catch (error) {
    logger.warn('No se pudo purgar la caché', { error: String(error) });
  }
}

