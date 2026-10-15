/**
 * @module services/supabase
 * @description Cliente único de Supabase — Módulo 2 (Authentication).
 *
 * Responsabilidad única (Fase 2 §2): "único cliente Supabase, un solo
 * proyecto". Reemplaza el `sbFetch()` manual del Archivo 1 (Fase 1 §1.3) por
 * el SDK oficial `@supabase/supabase-js`.
 *
 * Ningún otro módulo debe importar el SDK ni instanciar su propio cliente:
 * todos consumen `getSupabaseClient()` de aquí.
 */

import { APP_CONFIG, ConfigurationError } from '../js/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('supabase');

/**
 * Sin bundler de aplicación (arquitectura vanilla), el SDK se sirve DESDE EL MISMO
 * ORIGEN: `vendor/supabase-js.mjs` es `@supabase/supabase-js` 2.118.0 empaquetado con
 * esbuild (ver `vendor/LEEME.md` para regenerarlo). Sin CDN externo: la app funciona
 * offline, la CSP no necesita permitir scripts de terceros y no hay riesgo de cadena
 * de suministro en tiempo de ejecución.
 */
const SUPABASE_JS_MODULE_URL = new URL('../vendor/supabase-js.mjs', import.meta.url).href;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let clientInstance = null;

/** @type {Promise<import('@supabase/supabase-js').SupabaseClient> | null} */
let clientInitPromise = null;

/**
 * Obtiene (o crea perezosamente) el cliente único. Las llamadas concurrentes
 * durante la inicialización comparten la misma promesa.
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient>}
 * @throws {ConfigurationError} si `APP_CONFIG.supabase` está incompleto.
 */
export async function getSupabaseClient() {
  if (clientInstance) return clientInstance;
  if (clientInitPromise) return clientInitPromise;

  clientInitPromise = (async () => {
    const { url, anonKey } = APP_CONFIG.supabase;
    if (!url || !anonKey) {
      throw new ConfigurationError('APP_CONFIG.supabase está incompleto. Revise js/env.js (ver js/env.example.js).');
    }

    const { createClient } = await import(/* @vite-ignore */ SUPABASE_JS_MODULE_URL);

    clientInstance = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: `${APP_CONFIG.app.storagePrefix}:supabase-auth`,
      },
    });

    logger.info('Cliente Supabase inicializado', { url });
    return clientInstance;
  })();

  // Si la inicialización falla, se libera la promesa para permitir reintento.
  clientInitPromise.catch(() => {
    clientInitPromise = null;
  });

  return clientInitPromise;
}

/** Solo para pruebas automatizadas: reinicia el singleton. */
export function _resetSupabaseClientForTests() {
  clientInstance = null;
  clientInitPromise = null;
}

export default { getSupabaseClient };
