/**
 * @module js/app
 * @description Bootstrap de NeuroLab SST — Core Platform (Módulo 1).
 *
 * Responsabilidad única (Fase 2 §2, `app.js`): "carga sesión, config de
 * empresa, arranca router". En este módulo (Core Platform) todavía no
 * existe sesión (Módulo 2 — Authentication) ni configuración de empresa
 * (Módulo 3 — Organization), así que el bootstrap de esta entrega:
 *
 *   1. Valida configuración de entorno (a través de `config.js`).
 *   2. Instala manejadores globales de error (frontera de error de app).
 *   3. Carga el diccionario de idioma (`i18n.js`).
 *   4. Aplica los tokens de marca por defecto (`theming.js`).
 *   5. Registra las rutas núcleo (home placeholder, 404) y arranca el router.
 *   6. Registra el Service Worker (PWA) fuera de desarrollo.
 *
 * Los módulos futuros (auth.js, admin/*, dashboard/*) se conectan a este
 * bootstrap SIN modificarlo: registran sus propias rutas via
 * `router.registerRoute()` y sus propias guardas via `router.addGuard()`
 * desde sus propios archivos, importados por `app.js` únicamente cuando
 * ese módulo sea implementado (import explícito, no auto-descubrimiento
 * mágico — mantiene el grafo de dependencias legible).
 */

import { APP_CONFIG, ConfigurationError } from './config.js';
import { createLogger, setGlobalLogLevel } from '../services/logger.js';
import { eventBus, CORE_EVENTS } from '../services/event-bus.js';
import { initI18n, t } from './i18n.js';
import { applyBrandTokens } from './theming.js';
import { router } from './navigation.js';
import { createStore } from './state-store.js';
import { initAuthModule } from './auth.js';
import { initOrganizationModule } from './organization.js';
import { initEvaluationModule } from './evaluation-module.js';
import { initAdminModule } from './admin-module.js';
import { initDashboardModule } from './dashboard-module.js';

const logger = createLogger('app');

/** Estado núcleo del proceso de arranque, encapsulado (no global mutable). */
export const appStore = createStore({
  status: 'booting', // 'booting' | 'ready' | 'fatal-error'
  locale: APP_CONFIG.app.localeDefault,
});

/**
 * Renderiza la vista de inicio del Core Platform. Es un placeholder
 * deliberado: confirma que el núcleo arrancó correctamente y documenta al
 * equipo (o a QA) qué módulos faltan por activarse. Se reemplaza en el
 * Módulo Authentication por la pantalla de login como ruta `/`.
 * @param {HTMLElement} container
 */
function renderHomeView(container) {
  container.innerHTML = `
    <section class="view-panel" role="status">
      <span class="view-panel__badge">${t('core.appName')} · Core Platform</span>
      <h1>${t('core.home.title')}</h1>
      <p>${t('core.home.readyMessage')}</p>
      <div class="view-panel__pending">
        <h3>${t('core.home.pendingModulesTitle')}</h3>
        <p>${t('core.home.pendingModulesDescription')}</p>
      </div>
    </section>
  `;
}

/**
 * Renderiza la vista 404 núcleo, con acción para volver al inicio.
 * @param {HTMLElement} container
 */
function renderNotFoundView(container) {
  container.innerHTML = `
    <section class="view-panel" role="alert">
      <h1>${t('core.notFound.title')}</h1>
      <p>${t('core.notFound.description')}</p>
      <button type="button" class="button-primary" data-action="go-home">
        ${t('core.notFound.backAction')}
      </button>
    </section>
  `;
  container.querySelector('[data-action="go-home"]')?.addEventListener('click', () => {
    router.navigate(APP_CONFIG.routes.home);
  });
}

/** Registra las rutas propias del Core Platform. Módulos futuros añaden las suyas en sus propios archivos. */
function registerCoreRoutes() {
  router.registerRoute(APP_CONFIG.routes.home, {
    title: () => `${t('core.home.title')} · ${t('core.appName')}`,
    render: renderHomeView,
    // Requiere sesión activa (la guarda instalada por js/auth.js lo hace cumplir).
    meta: { publico: false, menu: { etiqueta: 'core.menu.home', orden: 0 } },
  });

  router.setNotFound({
    title: () => `${t('core.notFound.title')} · ${t('core.appName')}`,
    render: renderNotFoundView,
  });
}

/**
 * Muestra un mensaje dentro de la frontera de error del app-shell
 * (`#app-error-boundary`), definida en `index.html` y oculta por defecto.
 * @param {string} title
 * @param {string} description
 */
function showErrorBoundary(title, description) {
  const boundary = document.querySelector(APP_CONFIG.dom.errorBoundarySelector);
  if (!boundary) return;
  boundary.innerHTML = `<h2>${title}</h2><p>${description}</p>`;
  boundary.setAttribute('data-visible', 'true');
}

/**
 * Instala manejadores globales de error de JavaScript y de promesas
 * rechazadas sin capturar, para que ningún fallo silencioso deje al
 * operador frente a una pantalla en blanco sin explicación — crítico en un
 * flujo de evaluación de fatiga donde la confianza del operador en la
 * herramienta importa.
 */
function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    logger.error('Error global no capturado', { message: event.message, filename: event.filename, lineno: event.lineno });
    eventBus.emit(CORE_EVENTS.UNHANDLED_ERROR, { source: 'window.error', error: event.error ?? event.message });
    showErrorBoundary(t('core.genericError.title'), t('core.genericError.description'));
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Promesa rechazada no capturada', { reason: String(event.reason) });
    eventBus.emit(CORE_EVENTS.UNHANDLED_ERROR, { source: 'unhandledrejection', error: event.reason });
    showErrorBoundary(t('core.genericError.title'), t('core.genericError.description'));
  });
}

/**
 * Registra el Service Worker del app-shell (PWA). Fuera de desarrollo por
 * defecto (`APP_CONFIG.pwa.registrarEnDesarrollo === false`) para evitar
 * que una caché de SW obsoleta interfiera con la recarga en caliente
 * durante el desarrollo local. La cola de sincronización offline
 * (IndexedDB + reintento) se añade en el Módulo Offline Engine — este
 * registro solo habilita la instalabilidad y el caché del app-shell
 * estático.
 */
async function registerServiceWorker() {
  const shouldRegister = APP_CONFIG.app.esProduccion || APP_CONFIG.pwa.registrarEnDesarrollo;
  if (!shouldRegister || !('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register(APP_CONFIG.pwa.serviceWorkerUrl, { type: 'module' });
    logger.info('Service Worker registrado', { url: APP_CONFIG.pwa.serviceWorkerUrl });
  } catch (error) {
    // El fallo de registro del SW no debe impedir el arranque de la app —
    // la plataforma funciona igual sin instalabilidad PWA, solo se degrada esa capacidad.
    logger.warn('No se pudo registrar el Service Worker', { error: String(error) });
  }
}

/**
 * Punto de entrada de la aplicación. Orquesta el arranque completo en
 * orden de dependencias. Cualquier fallo en un paso crítico (configuración
 * o i18n) detiene el arranque con una pantalla explícita en vez de dejar
 * la interfaz a medio construir.
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  installGlobalErrorHandlers();
  setGlobalLogLevel(APP_CONFIG.logging.nivel);

  logger.info('Iniciando Core Platform', { version: APP_CONFIG.app.version, entorno: APP_CONFIG.app.entorno });

  try {
    await initI18n(APP_CONFIG.app.localeDefault);
    appStore.setState({ locale: APP_CONFIG.app.localeDefault });

    const versionLabel = document.querySelector('[data-app-version]');
    if (versionLabel) {
      versionLabel.textContent = `${APP_CONFIG.app.nombre} · v${APP_CONFIG.app.version}`;
    }

    applyBrandTokens(); // Tokens por defecto de la plataforma — la marca de empresa llega en el Módulo Organization.

    registerCoreRoutes();
    const authService = await initAuthModule({ router });
    initOrganizationModule({ router, authService });
    initEvaluationModule({ router, authService });
    initAdminModule({ router, authService });
    initDashboardModule({ router, authService });
    await router.start(APP_CONFIG.dom.appViewSelector);

    await registerServiceWorker();

    appStore.setState({ status: 'ready' });
    eventBus.emit(CORE_EVENTS.APP_READY, { timestamp: Date.now(), version: APP_CONFIG.app.version });
    logger.info('Core Platform listo', { version: APP_CONFIG.app.version });
  } catch (error) {
    appStore.setState({ status: 'fatal-error' });
    eventBus.emit(CORE_EVENTS.APP_FATAL_ERROR, { error: String(error) });
    logger.error('Fallo crítico durante el arranque', { error: String(error) });

    const boundary = document.querySelector(APP_CONFIG.dom.errorBoundarySelector);
    if (boundary) {
      boundary.innerHTML = `<h2>${t?.('core.fatalError.title') ?? 'NeuroLab SST no pudo iniciar'}</h2><p>${
        error instanceof Error ? error.message : String(error)
      }</p>`;
      boundary.setAttribute('data-visible', 'true');
    }
  }
}

/**
 * Captura errores de configuración (`ConfigurationError`) ANTES del ciclo
 * de import normal — `config.js` valida en el momento del import (top-level
 * throw), por lo que este archivo debe envolver su propia carga dinámica
 * para poder mostrar una pantalla de error legible en vez de dejar que el
 * navegador reporte un error de módulo no manejado en consola.
 */
function boot() {
  bootstrap().catch((error) => {
    const boundary = document.querySelector('#app-error-boundary');
    const isConfigError = error instanceof ConfigurationError;
    const title = isConfigError ? 'Aplicación no configurada' : 'NeuroLab SST no pudo iniciar';
    if (boundary) {
      boundary.innerHTML = `<h2>${title}</h2><p>${error.message ?? String(error)}</p>`;
      boundary.setAttribute('data-visible', 'true');
    }
    // eslint-disable-next-line no-console -- último recurso si ni siquiera el error boundary del DOM está disponible.
    console.error('[NeuroLab] Fallo fatal de arranque:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
