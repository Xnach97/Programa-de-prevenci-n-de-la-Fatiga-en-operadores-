/**
 * @module services/logger
 * @description Servicio común de logging técnico — Core Platform (Módulo 1).
 *
 * Responsabilidad única: producir entradas de log estructuradas
 * (nivel, ámbito, mensaje, contexto, timestamp) y despacharlas a uno o más
 * "sinks" (destinos). Por defecto solo existe el sink de consola, pero el
 * mecanismo de `registerSink` permite añadir en el futuro un sink remoto
 * (por ejemplo, hacia una tabla de observabilidad) sin modificar ningún
 * módulo consumidor — Open/Closed Principle.
 *
 * IMPORTANTE — este logger es de diagnóstico técnico, NO es la tabla de
 * `auditoria` de negocio definida en Fase 3 §12. `auditoria` registra
 * eventos de negocio con valor legal/probatorio (quién cambió qué
 * configuración) y se implementa en `services/audit.js` (módulo Audit &
 * Config). No deben mezclarse: un error de red no es un evento de
 * auditoría, y un cambio de baremo no debe depender de que el logger
 * técnico esté funcionando.
 */

/** @enum {number} */
export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

/** @type {Array<(entry: LogEntry) => void>} */
const sinks = [];

/** Nivel mínimo global; entradas por debajo de este nivel se descartan antes de llegar a los sinks. */
let globalMinLevel = LOG_LEVELS.info;

/**
 * @typedef {Object} LogEntry
 * @property {'debug'|'info'|'warn'|'error'} level
 * @property {string} scope - Módulo/ámbito que emite el log (ej. 'app', 'navigation').
 * @property {string} message
 * @property {Record<string, unknown>} [context]
 * @property {string} timestamp - ISO 8601.
 */

/**
 * Sink por defecto: escribe en la consola del navegador con el método
 * apropiado por nivel, prefijando el ámbito para facilitar el filtrado.
 * @param {LogEntry} entry
 */
function consoleSink(entry) {
  const prefix = `[NeuroLab][${entry.scope}]`;
  const consoleMethod = { debug: 'debug', info: 'info', warn: 'warn', error: 'error' }[entry.level] ?? 'log';
  const args = [prefix, entry.message];
  if (entry.context && Object.keys(entry.context).length > 0) {
    args.push(entry.context);
  }
  // eslint-disable-next-line no-console -- único punto autorizado de acceso directo a console.*
  console[consoleMethod](...args);
}

sinks.push(consoleSink);

/**
 * Establece el nivel mínimo global de logging. Útil para silenciar `debug`
 * en producción sin condicionales dispersos por el código.
 * @param {'debug'|'info'|'warn'|'error'} level
 */
export function setGlobalLogLevel(level) {
  if (!(level in LOG_LEVELS)) {
    throw new RangeError(`Nivel de log desconocido: "${level}"`);
  }
  globalMinLevel = LOG_LEVELS[level];
}

/**
 * Registra un sink adicional (ej. envío remoto). Devuelve una función para
 * desregistrarlo, siguiendo el mismo contrato de suscripción que
 * `services/event-bus.js` para mantener consistencia entre servicios
 * comunes.
 * @param {(entry: LogEntry) => void} sinkFn
 * @returns {() => void}
 */
export function registerSink(sinkFn) {
  sinks.push(sinkFn);
  return () => {
    const index = sinks.indexOf(sinkFn);
    if (index !== -1) sinks.splice(index, 1);
  };
}

/**
 * Despacha una entrada de log a todos los sinks registrados si supera el
 * nivel mínimo global. Los fallos de un sink individual se aíslan para que
 * un sink remoto caído nunca rompa el flujo de la aplicación.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} scope
 * @param {string} message
 * @param {Record<string, unknown>} [context]
 */
function dispatch(level, scope, message, context) {
  if (LOG_LEVELS[level] < globalMinLevel) return;

  /** @type {LogEntry} */
  const entry = {
    level,
    scope,
    message,
    context: context ?? undefined,
    timestamp: new Date().toISOString(),
  };

  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // Un sink defectuoso no debe interrumpir el logging de los demás ni la app.
    }
  }
}

/**
 * Crea un logger con ámbito fijo (nombre del módulo consumidor), evitando
 * que cada módulo tenga que repetir su propio nombre en cada llamada.
 * @param {string} scope
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 */
export function createLogger(scope) {
  if (!scope || typeof scope !== 'string') {
    throw new TypeError('createLogger requiere un "scope" (nombre de módulo) no vacío.');
  }
  return {
    debug: (message, context) => dispatch('debug', scope, message, context),
    info: (message, context) => dispatch('info', scope, message, context),
    warn: (message, context) => dispatch('warn', scope, message, context),
    error: (message, context) => dispatch('error', scope, message, context),
  };
}

export default { createLogger, setGlobalLogLevel, registerSink, LOG_LEVELS };
