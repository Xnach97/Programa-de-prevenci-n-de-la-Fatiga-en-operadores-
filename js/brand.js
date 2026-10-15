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

const NEGRO_TEXTO = '#0b0f17';
const BLANCO_TEXTO = '#ffffff';

/** Luminancia relativa WCAG de un color `#rrggbb`. */
export function luminancia(hex) {
  const canal = (i) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/** Relación de contraste WCAG entre dos colores `#rrggbb` (1–21). */
export function contraste(a, b) {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Color de texto legible sobre el color de marca (WCAG AA ≥ 4.5:1 para texto normal).
 * Blanco si su contraste supera 5.2 (margen para el efecto hover) o es el mejor de los dos; si no, casi negro.
 * Cada empresa elige su color: el texto de los botones se adapta en vez de fallar.
 * @param {string} hex `#rrggbb` ya saneado
 * @returns {string}
 */
export function textoSobre(hex) {
  const color = sanitizarColor(hex);
  if (!color) return BLANCO_TEXTO;
  const conBlanco = contraste(color, BLANCO_TEXTO);
  const conNegro = contraste(color, NEGRO_TEXTO);
  // En la franja de grises medios ninguno de los dos llega a 4.5:1; se elige el mejor posible.
  return conBlanco >= 5.2 || conBlanco > conNegro ? BLANCO_TEXTO : NEGRO_TEXTO;
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

export default { luminancia, contraste, textoSobre, marcaATokens, sanitizarColor, sanitizarFuente, sanitizarLogoUrl, escaparParaCssUrl };
