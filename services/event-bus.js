/**
 * @module services/event-bus
 * @description Bus de eventos de aplicación — Core Platform (Módulo 1).
 *
 * Responsabilidad única: permitir que módulos que no se conocen entre sí se
 * comuniquen mediante eventos nombrados, en vez de llamarse directamente o
 * compartir estado global mutable (el anti-patrón `estado`/`chartCache`
 * identificado en Fase 1 §1.2 #8 y prohibido en Fase 2 §6).
 *
 * Ejemplo de uso previsto en módulos futuros: `alerts.js` (Módulo Rules &
 * Alerts) emite `CORE_EVENTS.ALERT_RAISED` sin conocer si hay un componente
 * de UI escuchando; `dashboard/resumen.js` se suscribe sin conocer el motor
 * de reglas. Ninguno de los dos importa al otro.
 */

/**
 * Catálogo de eventos núcleo emitidos por el Core Platform. Los módulos de
 * dominio (Auth, Organization, Testing, etc.) declaran los suyos propios en
 * su propio archivo de constantes junto a su código — este catálogo NO debe
 * crecer con eventos de negocio, solo de infraestructura.
 * @enum {string}
 */
export const CORE_EVENTS = Object.freeze({
  APP_READY: 'core:app-ready',
  APP_FATAL_ERROR: 'core:app-fatal-error',
  ROUTE_CHANGED: 'core:route-changed',
  ROUTE_NOT_FOUND: 'core:route-not-found',
  ROUTE_GUARD_REJECTED: 'core:route-guard-rejected',
  THEME_APPLIED: 'core:theme-applied',
  I18N_READY: 'core:i18n-ready',
  UNHANDLED_ERROR: 'core:unhandled-error',
});

/**
 * Bus de publicación/suscripción mínimo, sin dependencias externas.
 * Instancia única exportada como singleton (`eventBus`) — no se expone la
 * clase para evitar que distintos módulos creen buses paralelos por error,
 * lo que reintroduciría el problema de estado disperso que este servicio
 * busca resolver.
 */
class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listenersByEvent = new Map();
  }

  /**
   * Suscribe un manejador a un evento.
   * @param {string} eventName
   * @param {(payload: unknown) => void} handler
   * @returns {() => void} función de desuscripción.
   */
  on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`eventBus.on("${eventName}") requiere un handler de tipo función.`);
    }
    if (!this.listenersByEvent.has(eventName)) {
      this.listenersByEvent.set(eventName, new Set());
    }
    this.listenersByEvent.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  /**
   * Suscribe un manejador que se ejecuta una única vez y luego se desuscribe automáticamente.
   * @param {string} eventName
   * @param {(payload: unknown) => void} handler
   * @returns {() => void} función de desuscripción anticipada.
   */
  once(eventName, handler) {
    const unsubscribe = this.on(eventName, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /**
   * Elimina un manejador previamente suscrito.
   * @param {string} eventName
   * @param {Function} handler
   */
  off(eventName, handler) {
    this.listenersByEvent.get(eventName)?.delete(handler);
  }

  /**
   * Emite un evento a todos los suscriptores. Los errores de un manejador
   * individual se aíslan y se reportan por consola (no se usa el logger
   * aquí para evitar una dependencia circular entre servicios comunes) para
   * que un listener defectuoso nunca detenga la emisión hacia los demás.
   * @param {string} eventName
   * @param {unknown} [payload]
   */
  emit(eventName, payload) {
    const handlers = this.listenersByEvent.get(eventName);
    if (!handlers || handlers.size === 0) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        // eslint-disable-next-line no-console -- aislamiento de fallos de listeners, ver docstring.
        console.error(`[NeuroLab][event-bus] Error en listener de "${eventName}":`, error);
      }
    }
  }

  /**
   * Elimina todos los listeners de un evento, o de todos los eventos si no
   * se especifica ninguno. Uso previsto: limpieza en pruebas automatizadas.
   * @param {string} [eventName]
   */
  clear(eventName) {
    if (eventName) {
      this.listenersByEvent.delete(eventName);
    } else {
      this.listenersByEvent.clear();
    }
  }
}

/** Instancia única del bus de eventos, compartida por toda la aplicación. */
export const eventBus = new EventBus();

export default eventBus;
