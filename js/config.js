/**
 * @module js/config
 * @description Configuración central de NeuroLab SST — Core Platform (Módulo 1).
 *
 * Responsabilidad única: leer credenciales/parámetros inyectados en runtime
 * vía `window.__NEUROLAB_ENV__` (poblado por `js/env.js`, NO versionado —
 * ver `js/env.example.js`), validarlos de forma estricta y exponer un
 * objeto de configuración inmutable. Ningún otro módulo debe leer
 * `window.__NEUROLAB_ENV__` directamente ni declarar valores por defecto de
 * URL/clave de Supabase: este es el único punto de verdad. Esto elimina el
 * patrón de claves hardcodeadas identificado en Fase 1 (§1.2 #3, §2.2 #2) y
 * prohibido explícitamente en Fase 2 (§6).
 *
 * Este módulo NO instancia el cliente de Supabase — eso corresponde a
 * `services/supabase.js` (Módulo 2 — Authentication), que consumirá
 * `APP_CONFIG.supabase`.
 */

const REQUIRED_ENV_KEYS = Object.freeze(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
const VALID_APP_ENVIRONMENTS = Object.freeze(['development', 'staging', 'production']);
const VALID_LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

/**
 * Error específico de configuración, distinguible de errores de negocio en
 * tiempo de arranque para que `app.js` pueda mostrar una pantalla
 * "aplicación no configurada" en vez de un error genérico de bootstrap.
 */
export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Lee el objeto de entorno inyectado por `js/env.js`.
 * @returns {Record<string, string>}
 * @throws {ConfigurationError} si `js/env.js` no fue cargado.
 */
function readRawEnv() {
  const env = window.__NEUROLAB_ENV__;
  if (!env || typeof env !== 'object') {
    throw new ConfigurationError(
      'js/env.js no fue cargado o no definió window.__NEUROLAB_ENV__. ' +
        'Copie js/env.example.js a js/env.js y complete las credenciales ' +
        'del proyecto Supabase único (Fase 3) antes de continuar.'
    );
  }
  return env;
}

/**
 * Valida presencia y forma mínima de las claves de entorno requeridas.
 * @param {Record<string, string>} env
 * @throws {ConfigurationError}
 */
function validateEnv(env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new ConfigurationError(
      `js/env.js está incompleto. Faltan o son inválidas las claves: ${missing.join(', ')}.`
    );
  }

  if (env.SUPABASE_URL.includes('TU-PROYECTO')) {
    throw new ConfigurationError(
      'SUPABASE_URL sigue siendo el valor de plantilla. Configure el proyecto ' +
        'Supabase único (Fase 3 §1) antes de arrancar la aplicación.'
    );
  }

  const appEnv = env.APP_ENV ?? 'development';
  if (!VALID_APP_ENVIRONMENTS.includes(appEnv)) {
    throw new ConfigurationError(
      `APP_ENV inválido: "${appEnv}". Valores permitidos: ${VALID_APP_ENVIRONMENTS.join(', ')}.`
    );
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new ConfigurationError(
      `LOG_LEVEL inválido: "${logLevel}". Valores permitidos: ${VALID_LOG_LEVELS.join(', ')}.`
    );
  }
}

const rawEnv = readRawEnv();
validateEnv(rawEnv);

/**
 * Configuración de plataforma, congelada en sus tres niveles para que
 * ningún módulo pueda mutarla en tiempo de ejecución. Es de solo lectura
 * por diseño: la configuración *de negocio* (marca, pesos ICO, baremos,
 * feature flags) vive en Supabase (`configuracion_empresa`, Fase 3 §4) y se
 * gestiona desde `admin/configuracion.js` (Módulo Organization), nunca aquí
 * — este archivo solo conoce infraestructura, no reglas de negocio
 * (Fase 2 §1, principio 2: "Configuración sobre código").
 */
export const APP_CONFIG = Object.freeze({
  app: Object.freeze({
    nombre: 'NeuroLab SST',
    nombreCorto: 'NeuroLab',
    /** Versión del Core Platform. Se incrementa por módulo entregado. */
    version: '8.0.0-core-platform',
    entorno: rawEnv.APP_ENV ?? 'development',
    esProduccion: (rawEnv.APP_ENV ?? 'development') === 'production',
    localeDefault: 'es',
    localesSoportados: Object.freeze(['es']),
    storagePrefix: 'neurolab_sst',
  }),

  /** Credenciales de acceso a datos. El cliente real se construye en services/supabase.js (Módulo 2). */
  supabase: Object.freeze({
    url: rawEnv.SUPABASE_URL,
    anonKey: rawEnv.SUPABASE_ANON_KEY,
  }),

  logging: Object.freeze({
    nivel: rawEnv.LOG_LEVEL ?? 'info',
  }),

  /** Rutas núcleo reservadas por el Core Platform. Los demás módulos registran las suyas en navigation.js. */
  routes: Object.freeze({
    home: '/',
    notFound: '/404',
  }),

  /** Selectores de los contenedores del app-shell definidos en index.html. */
  dom: Object.freeze({
    appViewSelector: '#app-view',
    appNavSelector: '#app-nav',
    errorBoundarySelector: '#app-error-boundary',
  }),

  /** Claves de almacenamiento local con espacio de nombres — evita colisiones entre módulos. */
  storageKeys: Object.freeze({
    localePreferido: 'neurolab_sst:locale',
    temaAplicado: 'neurolab_sst:tema_aplicado',
  }),

  /** Registro del Service Worker (PWA). La cola de sincronización offline se añade en Módulo 9. */
  pwa: Object.freeze({
    serviceWorkerUrl: '/service-worker.js',
    /** Deshabilitado en desarrollo para evitar caché obsoleta durante iteración local. */
    registrarEnDesarrollo: false,
  }),
});

/** Atajo usado con frecuencia por otros módulos para decisiones sensibles al entorno. */
export const esProduccion = () => APP_CONFIG.app.esProduccion;

export default APP_CONFIG;
