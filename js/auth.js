/**
 * @module js/auth
 * @description Módulo de autenticación — capa de aplicación/UI, Módulo 2.
 *
 * Fase 2 §3: "auth.js — Única puerta de entrada. Traduce sesión de Supabase
 * Auth a un objeto {usuario, rol, empresa_id} que el resto de la app consulta;
 * nunca vuelve a tocar supabase.auth directamente desde otro módulo."
 *
 * Registra:
 *   - Rutas públicas `/login` y `/acceso-denegado`.
 *   - Una guarda global "segura por defecto": toda ruta cuyo `meta.publico` no
 *     sea `true` exige sesión activa.
 *   - Los controles de sesión (usuario, selector de empresa, cerrar sesión)
 *     dentro de `#app-nav`.
 *
 * Seguridad (OWASP A03 — inyección): ningún dato proveniente de la base de
 * datos se interpola en `innerHTML`; los controles de sesión se construyen con
 * APIs DOM (`textContent`). Solo textos de `locales/es.json` (confiables) se
 * usan en plantillas HTML.
 */

import { APP_CONFIG } from './config.js';
import { createLogger } from '../services/logger.js';
import { getSupabaseClient } from '../services/supabase.js';
import { getDatabase } from './database.js';
import { AuthService, AuthError } from '../services/auth-service.js';
import { t } from './i18n.js';

const logger = createLogger('auth');

/** @type {Promise<AuthService> | null} */
let authServicePromise = null;

/** Router inyectado por `initAuthModule`; evita imports dinámicos circulares. */
let routerRef = null;

/**
 * Instancia única de `AuthService`, conectada al cliente y al repositorio de
 * usuarios. Única función que otros módulos deben usar para obtener el servicio.
 * @returns {Promise<AuthService>}
 */
export async function getAuthService() {
  if (!authServicePromise) {
    authServicePromise = (async () => {
      const [supabaseClient, database] = await Promise.all([getSupabaseClient(), getDatabase()]);
      return new AuthService({ supabaseClient, usuariosRepository: database.usuarios });
    })().catch((error) => {
      authServicePromise = null; // permite reintento si la inicialización falló
      throw error;
    });
  }
  return authServicePromise;
}

/**
 * Mensaje seguro para el usuario: `AuthError` ya trae uno listo; cualquier otro
 * error (red caída, etc.) recibe un mensaje genérico.
 * @param {unknown} error
 * @returns {string}
 */
function mensajeDeErrorLegible(error) {
  if (error instanceof AuthError) return error.message;
  return t('auth.login.genericError');
}

/**
 * Formulario de login. Sin `alert()` nativo (Fase 1 §1.2 #7): los errores se
 * muestran inline con `role="alert"`.
 * @param {HTMLElement} container
 */
function renderLoginView(container) {
  container.innerHTML = `
    <section class="auth-panel">
      <h1>${t('auth.login.title')}</h1>
      <p>${t('auth.login.subtitle')}</p>
      <form id="login-form" novalidate>
        <label class="auth-panel__field">
          <span>${t('auth.login.emailLabel')}</span>
          <input type="email" name="email" required autocomplete="username" autofocus />
        </label>
        <label class="auth-panel__field">
          <span>${t('auth.login.passwordLabel')}</span>
          <input type="password" name="password" required autocomplete="current-password" />
        </label>
        <div class="auth-panel__error" role="alert" data-error hidden></div>
        <button type="submit" class="button-primary" data-submit>${t('auth.login.submit')}</button>
      </form>
    </section>
  `;

  const form = container.querySelector('#login-form');
  const errorBox = container.querySelector('[data-error]');
  const submitButton = container.querySelector('[data-submit]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    if (!email || !password) {
      errorBox.textContent = t('auth.login.missingFields');
      errorBox.hidden = false;
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = t('auth.login.submitting');

    try {
      const authService = await getAuthService();
      await authService.login(email, password);
      routerRef.navigate(APP_CONFIG.routes.home, { replace: true });
    } catch (error) {
      logger.warn('Fallo de login desde la UI', { error: String(error) });
      errorBox.textContent = mensajeDeErrorLegible(error);
      errorBox.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = t('auth.login.submit');
    }
  });
}

/**
 * Vista de "acceso denegado": destino de `requierePermiso` cuando el usuario
 * está autenticado pero carece del permiso.
 * @param {HTMLElement} container
 */
function renderAccessDeniedView(container) {
  container.innerHTML = `
    <section class="view-panel" role="alert">
      <h1>${t('auth.accessDenied.title')}</h1>
      <p>${t('auth.accessDenied.description')}</p>
      <button type="button" class="button-primary" data-action="go-home">${t('auth.accessDenied.backAction')}</button>
    </section>
  `;
  container.querySelector('[data-action="go-home"]')?.addEventListener('click', () => {
    routerRef.navigate(APP_CONFIG.routes.home);
  });
}

/**
 * Registra las rutas del módulo. Ambas son `meta.publico = true`.
 * @param {import('./navigation.js').router} router
 */
function registerAuthRoutes(router) {
  router.registerRoute('/login', {
    title: () => `${t('auth.login.title')} · ${t('core.appName')}`,
    render: renderLoginView,
    meta: { publico: true },
  });

  router.registerRoute('/acceso-denegado', {
    title: () => `${t('auth.accessDenied.title')} · ${t('core.appName')}`,
    render: renderAccessDeniedView,
    meta: { publico: true },
  });
}

/**
 * Guarda global de autenticación, segura por defecto. Un usuario autenticado
 * que visita `/login` es redirigido al inicio (botón "atrás" tras iniciar sesión).
 * @param {import('./navigation.js').router} router
 * @param {AuthService} authService
 */
function instalarGuardaDeAutenticacion(router, authService) {
  router.addGuard((context) => {
    if (context.path === '/login' && authService.estaAutenticado()) {
      return APP_CONFIG.routes.home;
    }
    if (context.route.meta?.publico === true) return true;
    return authService.estaAutenticado() ? true : '/login';
  });
}

/**
 * Fábrica de guardas por permiso para que módulos futuros protejan sus rutas
 * sin duplicar lógica. Vive aquí porque saber "qué es un permiso" es
 * responsabilidad del dominio de autenticación, no del router genérico.
 *
 * Uso: `router.addGuard(requierePermiso(PERMISOS.CATALOGOS_EDITAR, '/admin/catalogos'))`
 * protege únicamente la ruta indicada; las demás rutas pasan sin restricción.
 * @param {string} codigoPermiso
 * @param {string} [rutaProtegida] - Si se omite, aplica a toda ruta no pública.
 * @returns {(context: import('./navigation.js').GuardContext) => Promise<import('./navigation.js').GuardResult>}
 */
export function requierePermiso(codigoPermiso, rutaProtegida) {
  return async (context) => {
    if (rutaProtegida && context.route.path !== rutaProtegida) return true;
    if (context.route.meta?.publico === true) return true;
    const authService = await getAuthService();
    if (!authService.estaAutenticado()) return '/login';
    return authService.tienePermiso(codigoPermiso) ? true : '/acceso-denegado';
  };
}

/**
 * Renderiza (o limpia) los controles de sesión en `#app-nav` con APIs DOM,
 * sin interpolar datos de base de datos en HTML.
 * @param {AuthService} authService
 */
function renderSessionControls(authService) {
  const navContainer = document.querySelector(APP_CONFIG.dom.appNavSelector);
  if (!navContainer) return;

  navContainer.replaceChildren();
  const state = authService.sessionStore.getState();
  if (state.estado !== 'autenticado') return;

  const userLabel = document.createElement('span');
  userLabel.className = 'session-controls__user';
  userLabel.textContent = state.usuario?.nombre_completo ?? state.usuario?.email ?? '';
  navContainer.append(userLabel);

  const asignaciones = Object.values(state.asignacionesPorEmpresa);
  if (asignaciones.length > 1) {
    const select = document.createElement('select');
    select.className = 'session-controls__empresa';
    select.setAttribute('aria-label', t('auth.session.switchEmpresa'));
    for (const asignacion of asignaciones) {
      const option = document.createElement('option');
      option.value = asignacion.empresaId;
      option.textContent = asignacion.empresaNombre;
      option.selected = asignacion.empresaId === state.empresaActualId;
      select.append(option);
    }
    select.addEventListener('change', (event) => {
      authService.cambiarEmpresaActiva(event.target.value);
    });
    navContainer.append(select);
  }

  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'session-controls__logout';
  logoutButton.textContent = t('auth.session.logout');
  logoutButton.addEventListener('click', async () => {
    try {
      await authService.logout();
    } finally {
      routerRef.navigate('/login', { replace: true });
    }
  });
  navContainer.append(logoutButton);
}

/**
 * Punto de entrada del módulo, invocado una vez desde `app.js` después de
 * `registerCoreRoutes()` y antes de `router.start()`.
 * @param {{router: import('./navigation.js').router}} dependencias
 * @returns {Promise<AuthService>}
 */
export async function initAuthModule({ router }) {
  routerRef = router;
  const authService = await getAuthService();
  await authService.init();

  registerAuthRoutes(router);
  instalarGuardaDeAutenticacion(router, authService);

  renderSessionControls(authService);
  authService.sessionStore.subscribe((state, previousState) => {
    renderSessionControls(authService);
    // Sesión cerrada desde otra pestaña/dispositivo: sacar al usuario de la vista protegida.
    if (previousState.estado === 'autenticado' && state.estado === 'anonimo') {
      router.navigate('/login', { replace: true });
    }
  });

  logger.info('Módulo de autenticación inicializado', { estado: authService.sessionStore.getState().estado });
  return authService;
}

export default { initAuthModule, getAuthService, requierePermiso };
