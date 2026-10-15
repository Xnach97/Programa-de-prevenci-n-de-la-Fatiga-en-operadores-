/**
 * @module js/brand
 * @description Traduce y SANEA la marca de una empresa (`configuracion_empresa.marca`,
 * Fase 3 §4) a tokens de theming.
 *
 * La marca la edita un administrador de empresa y termina escrita en
 * `style.setProperty`. Un valor hostil (p. ej. un logo con `')` o una fuente con
 * `;`) podría inyectar CSS o disparar peticiones a hosts arbitrarios, por lo que
 * cada token se valida con una lista blanca estricta; un valor inválido se
 * descarta y se conserva el valor por defecto de la plataforma.
 *
 * Módulo puro (sin DOM): testeable con `node --test`.
 */

const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;
/** Familias separadas por coma; cada una con letras, dígitos, espacios, guiones o comillas simples. */
const FUENTE_SEGURA = /^[\p{L}\p{N} \-',]{1,200}$/u;
const LOGO_MAX_LONGITUD = 2048;

/**
 * @param {unknown} valor
 * @returns {string|null} Color `#RRGGBB` en minúsculas o null si es inválido.
 */
export function sanitizarColor(valor) {
  return typeof valor === 'string' && COLOR_HEX.test(valor.trim()) ? valor.trim().toLowerCase() : null;
}

/**
 * @param {unknown} valor
 * @returns {string|null} Lista de familias tipográficas válida o null.
 */
export function sanitizarFuente(valor) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return FUENTE_SEGURA.test(limpio) ? limpio : null;
}

/**
 * Solo se admiten logos servidos por HTTPS, sin credenciales embebidas.
 * @param {unknown} valor
 * @returns {string|null} URL normalizada o null.
 */
export function sanitizarLogoUrl(valor) {
  if (typeof valor !== 'string' || valor.length > LOGO_MAX_LONGITUD) return null;
  let url;
  try {
    url = new URL(valor.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

/**
 * Escapa una cadena para usarla dentro de `url("…")` de CSS.
 * @param {string} valor
 * @returns {string}
 */
export function escaparParaCssUrl(valor) {
  return valor.replace(/[\\"\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/**
 * Convierte la marca de BD (snake_case) en tokens camelCase de `theming.js`,
 * descartando todo valor que no supere la validación.
 * @param {Record<string, unknown> | null | undefined} marca
 * @returns {Record<string, string>} Solo claves válidas.
 */
export function marcaATokens(marca) {
  if (!marca || typeof marca !== 'object') return {};
  const tokens = {};
  const asignar = (clave, valor) => {
    if (valor) tokens[clave] = valor;
  };
  asignar('colorPrimario', sanitizarColor(marca.color_primario));
  asignar('colorSecundario', sanitizarColor(marca.color_secundario));
  asignar('colorAcento', sanitizarColor(marca.color_acento));
  asignar('tipografiaDisplay', sanitizarFuente(marca.tipografia_display));
  asignar('tipografiaBase', sanitizarFuente(marca.tipografia ?? marca.tipografia_base));
  asignar('logoUrl', sanitizarLogoUrl(marca.logo_url));
  return tokens;
}

export default { marcaATokens, sanitizarColor, sanitizarFuente, sanitizarLogoUrl, escaparParaCssUrl };
