/**
 * @module js/i18n
 * @description Internacionalización mínima — Core Platform (Módulo 1), decisión 0.8 de Fase 2.
 *
 * Responsabilidad única: cargar un diccionario de textos desde
 * `/locales/{locale}.json` y resolver claves de la forma `"core.home.title"`
 * con interpolación simple de variables `{{variable}}`. Hoy solo existe
 * `es.json` — Fase 2 §0.8 es explícita en que NO se traduce nada todavía,
 * solo se extrae el texto de la lógica desde el día uno para que agregar un
 * idioma en el futuro sea un archivo JSON nuevo, no una reescritura.
 *
 * Ningún módulo debe tener strings de interfaz embebidos en JS a partir de
 * este módulo en adelante — deben vivir en `/locales/es.json` y resolverse
 * con `t('clave.anidada')`.
 */

import { createLogger } from '../services/logger.js';
import { eventBus, CORE_EVENTS } from '../services/event-bus.js';

const logger = createLogger('i18n');

/** @type {Record<string, unknown>} */
let dictionary = {};
let currentLocale = null;

/**
 * Resuelve una ruta de clave punteada (`"core.home.title"`) contra un
 * objeto anidado.
 * @param {Record<string, unknown>} source
 * @param {string} dottedKey
 * @returns {unknown}
 */
function resolvePath(source, dottedKey) {
  return dottedKey.split('.').reduce((accumulator, segment) => {
    if (accumulator !== null && typeof accumulator === 'object' && segment in accumulator) {
      return accumulator[segment];
    }
    return undefined;
  }, source);
}

/**
 * Sustituye placeholders `{{nombre}}` en un texto con valores de `vars`.
 * @param {string} template
 * @param {Record<string, string | number>} vars
 * @returns {string}
 */
function interpolate(template, vars) {
  if (!vars || Object.keys(vars).length === 0) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, variableName) => {
    return Object.prototype.hasOwnProperty.call(vars, variableName) ? String(vars[variableName]) : match;
  });
}

/**
 * Carga el diccionario del idioma solicitado y lo deja activo. Debe
 * invocarse una única vez durante el bootstrap (`app.js`) antes de
 * renderizar cualquier vista que use `t()`.
 * @param {string} locale - Código de idioma, ej. 'es'.
 * @returns {Promise<void>}
 */
export async function initI18n(locale) {
  const response = await fetch(`/locales/${locale}.json`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`No se pudo cargar el diccionario de idioma "${locale}" (HTTP ${response.status}).`);
  }
  dictionary = await response.json();
  currentLocale = locale;
  logger.info('Diccionario de idioma cargado', { locale });
  eventBus.emit(CORE_EVENTS.I18N_READY, { locale });
}

/**
 * Traduce una clave de diccionario. Si la clave no existe, registra una
 * advertencia y devuelve la clave misma entre corchetes — visible en QA sin
 * romper el renderizado en producción.
 * @param {string} key - Clave punteada, ej. 'core.home.title'.
 * @param {Record<string, string | number>} [vars] - Variables para interpolar.
 * @returns {string}
 */
export function t(key, vars) {
  const value = resolvePath(dictionary, key);
  if (typeof value !== 'string') {
    logger.warn('Clave de traducción no encontrada', { key, locale: currentLocale });
    return `[${key}]`;
  }
  return interpolate(value, vars);
}

/**
 * @returns {string|null} Código del idioma actualmente cargado, o `null` si `initI18n` no se ha ejecutado.
 */
export function getLocale() {
  return currentLocale;
}

export default { initI18n, t, getLocale };
