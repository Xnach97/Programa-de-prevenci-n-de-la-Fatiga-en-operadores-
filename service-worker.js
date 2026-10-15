/**
 * @file service-worker.js
 * @description Service Worker del app-shell — Core Platform (Módulo 1).
 *
 * Alcance DELIBERADAMENTE limitado a instalabilidad PWA y disponibilidad
 * offline del cascarón estático (HTML/CSS/JS/manifest). NO implementa cola
 * de sincronización de datos ni reintento de evaluaciones sin conexión —
 * esa responsabilidad pertenece a `services/offline-queue.js` (Módulo
 * Offline Engine, Fase 2 §0.4), que usará IndexedDB y se coordinará con
 * este Service Worker mediante `postMessage` cuando se implemente. Mezclar
 * ambas responsabilidades en un solo archivo violaría separación de
 * responsabilidades (Fase 2 §1, principio 3).
 *
 * Estrategia: cache-first para el app-shell (versionado por
 * `APP_SHELL_CACHE_NAME`), network-first implícito para todo lo demás
 * (peticiones a Supabase NUNCA se cachean aquí — deben ir siempre a red;
 * cachear respuestas de datos clínicos/personales en Service Worker sin
 * política de expiración explícita sería un riesgo de integridad de datos
 * y de privacidad, Ley 1581, Fase 2 §0.6).
 */

const APP_SHELL_CACHE_VERSION = 'v12';
const APP_SHELL_CACHE_NAME = `neurolab-app-shell-${APP_SHELL_CACHE_VERSION}`;

/** Activos mínimos del Core Platform. Cada módulo futuro que añada assets estáticos propios amplía esta lista. */
const APP_SHELL_ASSETS = Object.freeze([
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/style.css',
  '/css/auth.css',
  '/css/organization.css',
  '/css/testing.css',
  '/js/app.js',
  '/js/config.js',
  '/js/navigation.js',
  '/js/theming.js',
  '/js/i18n.js',
  '/js/state-store.js',
  '/js/auth.js',
  '/js/database.js',
  '/js/repositories/repository-error.js',
  '/js/repositories/usuarios-repository.js',
  '/js/repositories/empresas-repository.js',
  '/js/repositories/catalogos-repository.js',
  '/js/repositories/operadores-repository.js',
  '/js/brand.js',
  '/js/scientific.js',
  '/js/repositories/scientific-repository.js',
  '/services/scientific-service.js',
  '/statistics/scientific-error.js',
  '/statistics/analytics.js',
  '/statistics/percentiles.js',
  '/statistics/gaussian.js',
  '/statistics/score.js',
  '/statistics/ico.js',
  '/statistics/baremos.js',
  '/js/company-context.js',
  '/js/menu.js',
  '/js/operator.js',
  '/js/organization.js',
  '/js/organization-services.js',
  '/js/ui/dom.js',
  '/js/ui/forms.js',
  '/admin/catalogos.js',
  '/statistics/indicadores.js',
  '/services/indicadores-service.js',
  '/js/repositories/indicadores-repository.js',
  '/statistics/rules.js',
  '/services/reglas-service.js',
  '/services/configuracion-service.js',
  '/services/audit.js',
  '/js/repositories/rules-repository.js',
  '/js/repositories/audit-repository.js',
  '/js/ui/errors.js',
  '/js/ui/pager.js',
  '/js/admin-module.js',
  '/js/alerts.js',
  '/js/dashboard-module.js',
  '/vendor/supabase-js.mjs',
  '/js/research-module.js',
  '/js/repositories/research-repository.js',
  '/research/csv.js',
  '/research/research-service.js',
  '/research/research-view.js',
  '/js/offline.js',
  '/js/offline-storage.js',
  '/js/offline-status.js',
  '/services/offline-queue.js',
  '/services/read-cache.js',
  '/dashboard/chart-math.js',
  '/dashboard/charts.js',
  '/dashboard/dashboard-service.js',
  '/dashboard/views.js',
  '/css/dashboard.css',
  '/admin/configuracion.js',
  '/admin/reglas.js',
  '/admin/auditoria.js',
  '/js/evaluation.js',
  '/js/evaluation-module.js',
  '/js/repositories/testing-repository.js',
  '/services/evaluacion-service.js',
  '/tests/index.js',
  '/tests/test-registry.js',
  '/tests/_comun.js',
  '/tests/tutorial.js',
  '/tests/attention.js',
  '/tests/stroop.js',
  '/tests/memory.js',
  '/tests/reaction.js',
  '/services/logger.js',
  '/services/event-bus.js',
  '/services/supabase.js',
  '/services/auth-service.js',
  '/services/permissions-catalog.js',
  '/services/organization-error.js',
  '/services/catalogos-service.js',
  '/services/operadores-service.js',
  '/locales/es.json',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith('neurolab-app-shell-') && name !== APP_SHELL_CACHE_NAME)
            .map((staleCacheName) => caches.delete(staleCacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Nunca interceptar peticiones cross-origin (Supabase, CDNs) — solo el app-shell propio.
  if (requestUrl.origin !== self.location.origin) return;

  // Solo interceptar GET; POST/PATCH/DELETE (mutaciones de datos) van siempre a red.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          const isCacheableAsset = APP_SHELL_ASSETS.includes(requestUrl.pathname);
          if (isCacheableAsset && networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(APP_SHELL_CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Sin red y sin caché para este recurso: se propaga el fallo — no hay
          // una respuesta offline genérica que tenga sentido para peticiones no
          // anticipadas en el app-shell.
          return Response.error();
        });
    })
  );
});
