/**
 * @module services/read-cache
 * @description Caché de LECTURA con respaldo offline (Módulo 9). Red primero: si la
 * lectura funciona se guarda; si falla por causa transitoria (sin red, 5xx) se
 * devuelve el último valor guardado si no está vencido. Los fallos permanentes
 * (permisos, validación) nunca se tapan con caché.
 *
 * Solo se cachean datos de CONFIGURACIÓN necesarios para evaluar sin conexión
 * (pruebas, pesos ICO, baremos, configuración de empresa, historial para baremo
 * dinámico, el operador que se evalúa). Se purga al cerrar sesión.
 */

import { clasificarError } from './offline-queue.js';

export const TTL_CACHE_MS = 7 * 24 * 3_600_000;

/**
 * @param {object} objetivo Repositorio.
 * @param {Record<string, (args: any[]) => string|null>} metodos método → función que da la clave de caché (null = no cachear).
 * @param {{almacen: any, ahora?: () => number, ttlMs?: number}} opciones
 * @returns {object} Envoltorio con los mismos métodos; los no listados se delegan tal cual.
 */
export function conCacheLectura(objetivo, metodos, { almacen, ahora = () => Date.now(), ttlMs = TTL_CACHE_MS }) {
  const envoltorio = Object.create(objetivo);
  for (const [nombre, claveDe] of Object.entries(metodos)) {
    envoltorio[nombre] = async (...args) => {
      const clave = claveDe(args);
      try {
        const valor = await objetivo[nombre](...args);
        if (clave) {
          try { await almacen.put({ clave: `${nombre}:${clave}`, valor, guardado_en: ahora() }); } catch { /* caché best-effort */ }
        }
        return valor;
      } catch (error) {
        if (!clave || clasificarError(error) !== 'transitorio') throw error;
        let guardado;
        try { guardado = await almacen.get(`${nombre}:${clave}`); } catch { guardado = undefined; }
        if (guardado && ahora() - guardado.guardado_en <= ttlMs) return guardado.valor;
        throw error;
      }
    };
  }
  return envoltorio;
}

export default { conCacheLectura, TTL_CACHE_MS };
