/**
 * @module js/theming
 * @description Motor de theming — Core Platform (Módulo 1).
 *
 * Responsabilidad única (Fase 2 §3): al iniciar sesión, leer
 * `configuracion_empresa.marca` (Fase 3 §4: `{logo_url, color_primario,
 * color_secundario, tipografia}`) e inyectarla como CSS custom properties
 * en `:root`. Ningún componente visual debe referenciar un color fijo;
 * todos usan las variables definidas en `css/tokens.css`.
 *
 * Este módulo define el MECANISMO y aplica los valores por defecto de la
 * plataforma (ya presentes en tokens.css) para que la aplicación sea
 * usable antes de que exista sesión. La lectura real de
 * `configuracion_empresa.marca` desde Supabase depende de
 * `services/supabase.js` y `admin/configuracion.js`, que no existen hasta
 * los módulos Authentication y Organization — se documenta como
 * dependencia pendiente en la entrega de este módulo.
 */

import { createLogger } from '../services/logger.js';
import { eventBus, CORE_EVENTS } from '../services/event-bus.js';
import { createStore } from './state-store.js';
import { sanitizarColor, sanitizarFuente, sanitizarLogoUrl, escaparParaCssUrl, textoSobre } from './brand.js';

const logger = createLogger('theming');

/**
 * Mapa de claves de negocio (como llegarán desde `configuracion_empresa.marca`,
 * Fase 3 §4) hacia el nombre de la variable CSS correspondiente en
 * `tokens.css`. Centralizar este mapa aquí es lo que le permite a
 * `admin/configuracion.js` (módulo futuro) enviar un objeto de negocio sin
 * conocer nombres de variables CSS — bajo acoplamiento entre dominio y
 * presentación.
 * @type {Record<string, string>}
 */
const BRAND_TOKEN_TO_CSS_VARIABLE = Object.freeze({
  colorPrimario: '--color-primario',
  colorSecundario: '--color-secundario',
  colorAcento: '--color-acento',
  tipografiaDisplay: '--tipografia-display',
  tipografiaBase: '--tipografia-base',
  logoUrl: '--logo-url',
});

/**
 * Valores por defecto de la plataforma. Coinciden con los definidos en
 * `tokens.css`; se mantienen aquí también para que `resetToDefaultTokens()`
 * pueda restaurar el estado sin depender de leer el CSS computado.
 * @type {Record<string, string>}
 */
const DEFAULT_BRAND_TOKENS = Object.freeze({
  colorPrimario: '#2f8fd6',
  colorSecundario: '#1a6fb0',
  colorAcento: '#45c9b0',
  tipografiaDisplay: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif",
  tipografiaBase: "'Inter', 'Segoe UI', system-ui, sans-serif",
  logoUrl: null,
});

/** Store encapsulado con los tokens de marca actualmente aplicados (evita estado global disperso). */
const themeStore = createStore({ tokens: DEFAULT_BRAND_TOKENS, empresaId: null });

/**
 * Convierte un valor de logo (URL o null) al valor válido para la variable
 * CSS `--logo-url`, que se usa como `background` en `.app-header__logo`.
 * @param {string|null} logoUrl
 * @returns {string}
 */
function formatLogoCssValue(logoUrl) {
  const seguro = sanitizarLogoUrl(logoUrl);
  return seguro ? `url("${escaparParaCssUrl(seguro)}")` : 'none';
}

/**
 * Aplica un conjunto (parcial o completo) de tokens de marca al documento.
 * Valores no provistos conservan el token previamente aplicado (merge, no
 * reemplazo total), de modo que una empresa pueda definir solo colores y
 * heredar la tipografía por defecto de la plataforma.
 * @param {Partial<typeof DEFAULT_BRAND_TOKENS>} [tokens]
 * @param {{empresaId?: string}} [meta]
 */
export function applyBrandTokens(tokens = {}, meta = {}) {
  const mergedTokens = { ...themeStore.getState().tokens, ...tokens };
  const root = document.documentElement;

  for (const [businessKey, cssVariable] of Object.entries(BRAND_TOKEN_TO_CSS_VARIABLE)) {
    const value = mergedTokens[businessKey];
    if (businessKey === 'logoUrl') {
      root.style.setProperty(cssVariable, formatLogoCssValue(value));
      continue;
    }
    // Defensa en profundidad: aunque el origen ya sanea (brand.js), el único
    // punto que escribe CSS valida también, sea cual sea el llamador.
    const seguro = businessKey.startsWith('color') ? sanitizarColor(value) : sanitizarFuente(value);
    if (seguro) {
      root.style.setProperty(cssVariable, seguro);
    }
  }

  // Texto de los botones primarios siempre legible (WCAG AA) sea cual sea el color de la empresa.
  root.style.setProperty('--color-sobre-primario', textoSobre(mergedTokens.colorPrimario));

  themeStore.setState({ tokens: mergedTokens, empresaId: meta.empresaId ?? themeStore.getState().empresaId });

  logger.info('Tokens de marca aplicados', { empresaId: meta.empresaId ?? null, claves: Object.keys(tokens) });
  eventBus.emit(CORE_EVENTS.THEME_APPLIED, { tokens: mergedTokens, empresaId: meta.empresaId ?? null });
}

/**
 * Restaura los tokens de marca por defecto de la plataforma (usado, por
 * ejemplo, al cerrar sesión antes de que otro operador de otra empresa
 * inicie sesión en el mismo dispositivo — escenario kiosco).
 */
export function resetToDefaultTokens() {
  applyBrandTokens(DEFAULT_BRAND_TOKENS, { empresaId: null });
}

/**
 * @returns {Readonly<{tokens: typeof DEFAULT_BRAND_TOKENS, empresaId: string|null}>}
 */
export function getAppliedTheme() {
  return themeStore.getState();
}

export default { applyBrandTokens, resetToDefaultTokens, getAppliedTheme };
