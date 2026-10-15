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
 * Sin bundler (arquitectura vanilla), el SDK se carga como módulo ES desde
 * CDN. Se fija la versión mayor (`@2`) para evitar cambios de API no
 * anunciados en producción.
 */
const SUPABASE_JS_MODULE_URL = 'https://esm.sh/@supabase/supabase-js@2';

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
