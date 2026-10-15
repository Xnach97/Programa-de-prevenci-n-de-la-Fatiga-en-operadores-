/**
 * @module js/menu
 * @description Menú principal derivado de las rutas registradas
 * (`meta.menu = {etiqueta, orden}`) y filtrado por `meta.permiso`.
 *
 * Cada módulo declara su entrada en el menú al registrar su ruta; este archivo
 * no conoce ningún módulo concreto (Open/Closed). El filtrado por permiso es
 * solo de presentación: el control real está en las guardas y en RLS.
 */

import { h } from './ui/dom.js';
import { eventBus, CORE_EVENTS } from '../services/event-bus.js';
import { t } from './i18n.js';

/**
 * Entradas visibles para el estado de sesión dado, ordenadas por `orden`.
 * Pura: testeable sin DOM.
 * @param {Array<{path: string, meta?: {menu?: {etiqueta: string, orden?: number}, permiso?: string}}>} rutas
 * @param {{autenticado: boolean, tienePermiso: (codigo: string) => boolean}} sesion
 * @returns {Array<{path: string, etiqueta: string}>}
 */
export function entradasDeMenu(rutas, { autenticado, tienePermiso }) {
  if (!autenticado) return [];
  return rutas
    .filter((ruta) => ruta.meta?.menu && (!ruta.meta.permiso || tienePermiso(ruta.meta.permiso)))
    .sort((a, b) => (a.meta.menu.orden ?? 100) - (b.meta.menu.orden ?? 100))
    .map((ruta) => ({ path: ruta.path, etiqueta: ruta.meta.menu.etiqueta }));
}

/**
 * Monta el menú en `selector` y lo mantiene sincronizado con la sesión y la ruta.
 * @param {{
 *   router: import('./navigation.js').router,
 *   authService: import('../services/auth-service.js').AuthService,
 *   selector?: string,
 * }} dependencias
 * @returns {() => void} Función para desmontar.
 */
export function montarMenu({ router, authService, selector = '#app-menu' }) {
  const nav = document.querySelector(selector);
  if (!nav) return () => {};

  // ROUTE_CHANGED se emite ANTES de que el router actualice su store, por lo que
  // la ruta actual se toma del payload del evento y no de `router.getState()`.
  let actual = router.getState().currentPath ?? '/';

  const pintar = () => {
    const entradas = entradasDeMenu(router.listRoutes(), {
      autenticado: authService.estaAutenticado(),
      tienePermiso: (codigo) => authService.tienePermiso(codigo),
    });
    nav.replaceChildren(
      ...entradas.map((entrada) =>
        h('a', { href: `#${entrada.path}`, class: 'app-menu__link', 'aria-current': entrada.path === actual ? 'page' : null }, t(entrada.etiqueta)),
      ),
    );
    nav.hidden = entradas.length === 0;
  };

  const desuscribirSesion = authService.sessionStore.subscribe(pintar);
  const desuscribirRuta = eventBus.on(CORE_EVENTS.ROUTE_CHANGED, (payload) => {
    actual = payload?.path ?? actual;
    pintar();
  });
  pintar();
  return () => {
    desuscribirSesion();
    desuscribirRuta();
  };
}

export default { montarMenu, entradasDeMenu };
