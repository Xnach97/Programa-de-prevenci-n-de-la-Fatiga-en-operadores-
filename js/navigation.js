/**
 * @module js/navigation
 * @description Router de pantallas — Core Platform (Módulo 1).
 *
 * Responsabilidad única (Fase 2 §2, `navigation.js`): "reemplaza mostrar('id')
 * global" — ambos archivos originales (Fase 1) usaban una función global
 * `mostrar(idDePantalla)` que manipulaba `display` de nodos DOM
 * hardcodeados. Este router:
 *
 *   1. Es un registro EXTENSIBLE de rutas (`registerRoute`), siguiendo el
 *      mismo patrón que `test-registry.js` (Fase 2 §3) aplicará a las
 *      pruebas cognitivas en el Módulo Testing Engine: ningún módulo futuro
 *      (auth.js, admin/*, dashboard/*) requiere modificar navigation.js
 *      para añadir una pantalla — Open/Closed Principle.
 *   2. Soporta guardas de ruta (`addGuard`) como punto de extensión para
 *      que `auth.js` (Módulo 2 — Authentication) intercepte navegación a
 *      rutas protegidas sin que este módulo conozca nada de sesiones o
 *      roles — bajo acoplamiento entre routing y autenticación.
 *   3. Usa hash routing (`#/ruta`) porque la plataforma se sirve como
 *      archivo estático (sin servidor con reescritura de rutas), consistente
 *      con el resto del stack (HTML + JS plano, sin build step).
 */

import { createLogger } from '../services/logger.js';
import { eventBus, CORE_EVENTS } from '../services/event-bus.js';
import { createStore } from './state-store.js';

const logger = createLogger('navigation');

/**
 * @typedef {Object} RouteDefinition
 * @property {string} path - Patrón de ruta, ej. '/', '/operadores/:id'.
 * @property {(container: HTMLElement, params: Record<string,string>) => void | Promise<void>} render
 * @property {(() => string) | string} [title] - Título de documento; función para títulos dinámicos (i18n).
 * @property {Record<string, unknown>} [meta] - Metadatos libres consumidos por guardas (ej. { requiereAuth: true, permiso: 'evaluaciones.ver' }).
 */

/**
 * @typedef {Object} GuardContext
 * @property {string} path - Ruta solicitada (sin resolver aún contra params).
 * @property {RouteDefinition} route
 * @property {Record<string, string>} params
 */

/**
 * Resultado de una guarda: `true` permite la navegación, `false` la
 * bloquea silenciosamente (la guarda es responsable de su propio efecto
 * secundario, ej. mostrar un mensaje), y un `string` se interpreta como
 * ruta de redirección.
 * @typedef {true | false | string} GuardResult
 */

class Router {
  constructor() {
    /** @type {Map<string, RouteDefinition>} */
    this.routes = new Map();
    /** @type {Array<(context: GuardContext) => GuardResult | Promise<GuardResult>>} */
    this.guards = [];
    /** @type {RouteDefinition | null} */
    this.notFoundRoute = null;
    /** @type {HTMLElement | null} */
    this.container = null;
    this.store = createStore({ currentPath: null, isNavigating: false });
    this._onHashChange = this._onHashChange.bind(this);
  }

  /**
   * Registra una ruta. Lanza si el path ya está registrado, para detectar
   * colisiones entre módulos en tiempo de desarrollo en vez de en producción.
   * @param {string} path
   * @param {Omit<RouteDefinition, 'path'>} definition
   */
  registerRoute(path, definition) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError(`Ruta inválida: "${path}". Debe ser un string que empiece con "/".`);
    }
    if (typeof definition?.render !== 'function') {
      throw new TypeError(`La ruta "${path}" requiere una función "render(container, params)".`);
    }
    if (this.routes.has(path)) {
      throw new Error(`La ruta "${path}" ya está registrada. Revise colisiones entre módulos.`);
    }
    this.routes.set(path, { path, ...definition });
    logger.debug('Ruta registrada', { path });
  }

  /**
   * Define la vista mostrada cuando ninguna ruta registrada coincide.
   * @param {Omit<RouteDefinition, 'path'>} definition
   */
  setNotFound(definition) {
    this.notFoundRoute = { path: '*', ...definition };
  }

  /**
   * Registra una guarda global, ejecutada en orden de registro antes de
   * renderizar cualquier ruta. La primera guarda que devuelva `false` o un
   * string detiene la cadena.
   * @param {(context: GuardContext) => GuardResult | Promise<GuardResult>} guardFn
   * @returns {() => void} función para desregistrar la guarda.
   */
  addGuard(guardFn) {
    if (typeof guardFn !== 'function') {
      throw new TypeError('addGuard requiere una función.');
    }
    this.guards.push(guardFn);
    return () => {
      const index = this.guards.indexOf(guardFn);
      if (index !== -1) this.guards.splice(index, 1);
    };
  }

  /**
   * Intenta emparejar un path de solicitud contra las rutas registradas,
   * soportando segmentos dinámicos `:param`.
   * @param {string} requestedPath
   * @returns {{route: RouteDefinition, params: Record<string,string>} | null}
   */
  _matchRoute(requestedPath) {
    const requestedSegments = requestedPath.split('/').filter(Boolean);

    for (const route of this.routes.values()) {
      const routeSegments = route.path.split('/').filter(Boolean);
      if (routeSegments.length !== requestedSegments.length) continue;

      /** @type {Record<string,string>} */
      const params = {};
      const isMatch = routeSegments.every((segment, index) => {
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(requestedSegments[index]);
          return true;
        }
        return segment === requestedSegments[index];
      });

      if (isMatch) return { route, params };
    }
    return null;
  }

  /**
   * Lee el path actual desde `location.hash`, normalizado a formato `/ruta`.
   * @returns {string}
   */
  _readCurrentHashPath() {
    const rawHash = window.location.hash.replace(/^#/, '');
    return rawHash === '' ? '/' : rawHash;
  }

  /**
   * Ejecuta la cadena de guardas para una navegación candidata.
   * @param {GuardContext} context
   * @returns {Promise<GuardResult>}
   */
  async _runGuards(context) {
    for (const guard of this.guards) {
      // eslint-disable-next-line no-await-in-loop -- las guardas deben evaluarse en orden, no en paralelo.
      const result = await guard(context);
      if (result !== true) return result;
    }
    return true;
  }

  /**
   * Resuelve y renderiza la ruta correspondiente al path actual del hash.
   * Es el manejador central invocado en `start()` y en cada `hashchange`.
   * @returns {Promise<void>}
   */
  async _resolveAndRender() {
    if (!this.container) {
      throw new Error('Router.start() no fue invocado — no hay contenedor de renderizado.');
    }

    const requestedPath = this._readCurrentHashPath();
    this.store.setState({ isNavigating: true });

    const match = this._matchRoute(requestedPath);

    if (!match) {
      logger.warn('Ruta no encontrada', { path: requestedPath });
      eventBus.emit(CORE_EVENTS.ROUTE_NOT_FOUND, { path: requestedPath });
      await this._renderNotFound();
      this.store.setState({ isNavigating: false });
      return;
    }

    const guardContext = { path: requestedPath, route: match.route, params: match.params };
    const guardResult = await this._runGuards(guardContext);

    if (guardResult !== true) {
      this.store.setState({ isNavigating: false });
      if (typeof guardResult === 'string') {
        logger.info('Navegación redirigida por guarda', { desde: requestedPath, hacia: guardResult });
        this.navigate(guardResult, { replace: true });
      } else {
        logger.info('Navegación bloqueada por guarda', { path: requestedPath });
        eventBus.emit(CORE_EVENTS.ROUTE_GUARD_REJECTED, { path: requestedPath });
      }
      return;
    }

    await this._renderRoute(match.route, match.params, requestedPath);
    this.store.setState({ currentPath: requestedPath, isNavigating: false });
  }

  /**
   * Renderiza una ruta resuelta dentro del contenedor y actualiza el título del documento.
   * @param {RouteDefinition} route
   * @param {Record<string,string>} params
   * @param {string} requestedPath
   */
  async _renderRoute(route, params, requestedPath) {
    this.container.innerHTML = '';
    await route.render(this.container, params);

    if (route.title) {
      document.title = typeof route.title === 'function' ? route.title(params) : route.title;
    }

    logger.info('Ruta renderizada', { path: requestedPath });
    eventBus.emit(CORE_EVENTS.ROUTE_CHANGED, { path: requestedPath, params });
  }

  /** Renderiza la vista 404 registrada, o un mensaje mínimo si ninguna fue configurada. */
  async _renderNotFound() {
    this.container.innerHTML = '';
    if (this.notFoundRoute) {
      await this.notFoundRoute.render(this.container, {});
      if (this.notFoundRoute.title) {
        document.title = typeof this.notFoundRoute.title === 'function' ? this.notFoundRoute.title({}) : this.notFoundRoute.title;
      }
    } else {
      this.container.textContent = 'Página no encontrada.';
    }
  }

  /** Manejador vinculado del evento `hashchange` del navegador. */
  _onHashChange() {
    this._resolveAndRender().catch((error) => {
      logger.error('Fallo al resolver ruta', { error: String(error) });
    });
  }

  /**
   * Navega programáticamente a una ruta, actualizando `location.hash`.
   * @param {string} path
   * @param {{replace?: boolean}} [options]
   */
  navigate(path, options = {}) {
    const targetHash = `#${path}`;
    if (options.replace) {
      const url = new URL(window.location.href);
      url.hash = targetHash;
      window.location.replace(url.toString());
    } else {
      window.location.hash = targetHash;
    }
  }

  /**
   * Monta el router sobre un contenedor del DOM y realiza el primer render.
   * Debe invocarse una única vez durante el bootstrap.
   * @param {string} containerSelector
   */
  start(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) {
      throw new Error(`Router.start: no se encontró el contenedor "${containerSelector}".`);
    }
    this.container = container;
    window.addEventListener('hashchange', this._onHashChange);
    return this._resolveAndRender();
  }

  /** @returns {Readonly<{currentPath: string|null, isNavigating: boolean}>} */
  getState() {
    return this.store.getState();
  }
}

/**
 * Instancia única del router, compartida por toda la aplicación. Al igual
 * que `eventBus`, se expone como singleton para evitar que dos módulos
 * monten routers paralelos sobre contenedores distintos.
 */
export const router = new Router();

export default router;
