/**
 * @module services/auth-service
 * @description Servicio de dominio de autenticación — Módulo 2 (Authentication).
 *
 * Contrato de `auth.js` en Fase 2 §3: "Traduce sesión de Supabase Auth a un
 * objeto {usuario, rol, empresa_id} que el resto de la app consulta". Es la
 * capa de DOMINIO (Service Layer): no toca el DOM ni el router; eso es
 * responsabilidad de `js/auth.js`.
 *
 * Las funciones de transformación (`normalizarAsignaciones`,
 * `elegirEmpresaActiva`) se exportan sin dependencias de Supabase ni DOM para
 * poder probarse con el test runner de Node (ver `spec/`).
 */

import { createLogger } from './logger.js';
import { eventBus } from './event-bus.js';
import { createStore } from '../js/state-store.js';

const logger = createLogger('auth-service');

/** @enum {string} */
export const AUTH_EVENTS = Object.freeze({
  SESSION_RESTORED: 'auth:session-restored',
  SIGNED_IN: 'auth:signed-in',
  SIGNED_OUT: 'auth:signed-out',
  EMPRESA_CAMBIADA: 'auth:empresa-cambiada',
  SESSION_RESOLUTION_FAILED: 'auth:session-resolution-failed',
});

/** Error de dominio con mensaje ya listo para mostrar al usuario. */
export class AuthError extends Error {
  /**
   * @param {string} mensajeUsuario - Seguro de mostrar en la UI (nunca expone detalle interno del proveedor).
   * @param {unknown} [causaOriginal]
   */
  constructor(mensajeUsuario, causaOriginal) {
    super(mensajeUsuario);
    this.name = 'AuthError';
    this.causaOriginal = causaOriginal;
  }
}

/**
 * @typedef {Object} AsignacionEmpresa
 * @property {string} empresaId
 * @property {string} empresaNombre
 * @property {string} rolNombre
 * @property {Set<string>} permisos
 */

/**
 * Transforma las filas crudas de `usuarios_roles` (roles y permisos anidados)
 * en un mapa `empresaId -> AsignacionEmpresa`. Función pura.
 * @param {Array<object>} filasUsuarioRoles
 * @returns {Record<string, AsignacionEmpresa>}
 */
export function normalizarAsignaciones(filasUsuarioRoles) {
  /** @type {Record<string, AsignacionEmpresa>} */
  const asignacionesPorEmpresa = {};

  for (const fila of filasUsuarioRoles ?? []) {
    const empresaId = fila?.empresa_id;
    const rol = fila?.roles;
    if (!empresaId || !rol) continue;

    if (!asignacionesPorEmpresa[empresaId]) {
      asignacionesPorEmpresa[empresaId] = {
        empresaId,
        empresaNombre: fila.empresas?.nombre ?? empresaId,
        rolNombre: rol.nombre,
        permisos: new Set(),
      };
    }

    for (const rp of rol.roles_permisos ?? []) {
      const codigo = rp?.permisos?.codigo;
      if (codigo) asignacionesPorEmpresa[empresaId].permisos.add(codigo);
    }
  }

  return asignacionesPorEmpresa;
}

/**
 * Elige la empresa activa por defecto: la empresa "home" si el usuario tiene
 * asignación ahí; si no, la primera en orden alfabético de UUID
 * (determinista, reproducible en pruebas). Función pura.
 * @param {Record<string, AsignacionEmpresa>} asignacionesPorEmpresa
 * @param {string|null} empresaHomeId
 * @returns {string|null}
 */
export function elegirEmpresaActiva(asignacionesPorEmpresa, empresaHomeId) {
  const empresaIds = Object.keys(asignacionesPorEmpresa);
  if (empresaIds.length === 0) return null;
  if (empresaHomeId && asignacionesPorEmpresa[empresaHomeId]) return empresaHomeId;
  return [...empresaIds].sort()[0];
}

/**
 * @typedef {Object} AuthState
 * @property {'inicializando'|'anonimo'|'autenticado'|'error'} estado
 * @property {{id: string, nombre_completo: string, email: string, estado: string}|null} usuario
 * @property {Record<string, AsignacionEmpresa>} asignacionesPorEmpresa
 * @property {string|null} empresaActualId
 */

/** @type {AuthState} */
const ESTADO_INICIAL = Object.freeze({
  estado: 'inicializando',
  usuario: null,
  asignacionesPorEmpresa: {},
  empresaActualId: null,
});

/** @type {AuthState} */
const ESTADO_ANONIMO = Object.freeze({ ...ESTADO_INICIAL, estado: 'anonimo' });

export class AuthService {
  /**
   * @param {{
   *   supabaseClient: import('@supabase/supabase-js').SupabaseClient,
   *   usuariosRepository: import('../js/repositories/usuarios-repository.js').UsuariosRepository
   * }} dependencias - Inyección explícita (Service Layer testeable sin mocks globales).
   */
  constructor({ supabaseClient, usuariosRepository }) {
    if (!supabaseClient) throw new TypeError('AuthService requiere supabaseClient.');
    if (!usuariosRepository) throw new TypeError('AuthService requiere usuariosRepository.');
    this._client = supabaseClient;
    this._usuariosRepository = usuariosRepository;
    this._store = createStore(ESTADO_INICIAL);
    /** Id del usuario de Auth cuya sesión está resuelta, para no re-resolver por eventos redundantes. */
    this._usuarioAuthResueltoId = null;
    this._authStateUnsubscribe = null;
  }

  /** @returns {import('../js/state-store.js').Store<AuthState>} */
  get sessionStore() {
    return this._store;
  }

  /**
   * Restaura la sesión persistida y se suscribe a cambios futuros de estado
   * (login/logout en otra pestaña). Invocar una única vez durante el bootstrap.
   * @returns {Promise<void>}
   */
  async init() {
    const {
      data: { session },
    } = await this._client.auth.getSession();

    if (session) {
      await this._resolverSesion(session, AUTH_EVENTS.SESSION_RESTORED);
    } else {
      this._store.setState(ESTADO_ANONIMO);
    }

    const { data: subscriptionData } = this._client.auth.onAuthStateChange((event, newSession) => {
      logger.debug('Evento de auth.onAuthStateChange', { event });

      // El callback no debe ejecutar llamadas a Supabase de forma síncrona: supabase-js
      // documenta riesgo de deadlock. Se difiere al siguiente ciclo de eventos.
      setTimeout(() => {
        this._manejarCambioDeEstado(event, newSession).catch((error) => {
          logger.error('Fallo al procesar cambio de estado de auth', { error: String(error) });
        });
      }, 0);
    });
    this._authStateUnsubscribe = () => subscriptionData.subscription.unsubscribe();
  }

  /**
   * @param {string} event - Evento de supabase-js (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, ...).
   * @param {import('@supabase/supabase-js').Session | null} session
   */
  async _manejarCambioDeEstado(event, session) {
    if (!session) {
      this._usuarioAuthResueltoId = null;
      this._store.setState(ESTADO_ANONIMO);
      return;
    }
    // INITIAL_SESSION ya lo cubre init(); TOKEN_REFRESHED no cambia roles ni permisos.
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    // SIGNED_IN se re-emite al volver el foco a la pestaña: no re-resolver si ya está resuelto.
    if (event === 'SIGNED_IN' && this._usuarioAuthResueltoId === session.user.id) return;

    await this._resolverSesion(session, AUTH_EVENTS.SIGNED_IN);
  }

  /**
   * Autentica con correo y contraseña. Traduce errores del proveedor a
   * `AuthError` con mensaje seguro (OWASP: nunca confirma si el correo existe).
   * @param {string} email
   * @param {string} password
   * @returns {Promise<void>}
   */
  async login(email, password) {
    const { data, error } = await this._client.auth.signInWithPassword({ email, password });

    if (error) {
      // No se registra el correo completo: dato personal innecesario en logs técnicos.
      logger.warn('Intento de login fallido', { codigo: error.status });
      throw new AuthError('Correo o contraseña incorrectos.', error);
    }
    if (!data.session) {
      throw new AuthError('No se pudo iniciar sesión. Intenta de nuevo.', 'sin sesión en la respuesta');
    }

    await this._resolverSesion(data.session, AUTH_EVENTS.SIGNED_IN);

    if (this._store.getState().usuario?.estado === 'inactivo') {
      await this.logout();
      throw new AuthError('Tu cuenta está inactiva. Contacta a tu administrador.');
    }
  }

  /** Cierra sesión y deja el estado en `anonimo`. */
  async logout() {
    await this._client.auth.signOut();
    this._usuarioAuthResueltoId = null;
    this._store.setState(ESTADO_ANONIMO);
    logger.info('Sesión cerrada');
    eventBus.emit(AUTH_EVENTS.SIGNED_OUT);
  }

  /**
   * Cambia la empresa activa (usuarios con asignaciones en varias empresas).
   * @param {string} empresaId
   */
  cambiarEmpresaActiva(empresaId) {
    const { asignacionesPorEmpresa } = this._store.getState();
    if (!asignacionesPorEmpresa[empresaId]) {
      throw new RangeError(`El usuario no tiene ninguna asignación de rol en la empresa "${empresaId}".`);
    }
    this._store.setState({ empresaActualId: empresaId });
    logger.info('Empresa activa cambiada', { empresaId });
    eventBus.emit(AUTH_EVENTS.EMPRESA_CAMBIADA, { empresaId });
  }

  /** @returns {boolean} */
  estaAutenticado() {
    return this._store.getState().estado === 'autenticado';
  }

  /**
   * ¿Tiene el usuario el permiso en la empresa ACTIVA? Contraparte en cliente
   * de `tiene_permiso()` (migración 0002): sirve para decisiones de UI, nunca
   * como única barrera — RLS es la autoridad final en cada consulta.
   * @param {string} codigoPermiso
   * @returns {boolean}
   */
  tienePermiso(codigoPermiso) {
    const { asignacionesPorEmpresa, empresaActualId } = this._store.getState();
    if (!empresaActualId) return false;
    return asignacionesPorEmpresa[empresaActualId]?.permisos.has(codigoPermiso) ?? false;
  }

  /**
   * Resuelve una sesión cruda de Supabase Auth a `{usuario,
   * asignacionesPorEmpresa, empresaActualId}`. Único método que toca la red
   * para poblar el estado de sesión.
   * @param {import('@supabase/supabase-js').Session} session
   * @param {string} eventoAEmitir
   */
  async _resolverSesion(session, eventoAEmitir) {
    try {
      const [usuario, filasRoles] = await Promise.all([
        this._usuariosRepository.obtenerPerfilCompleto(session.user.id),
        this._usuariosRepository.listarRolesYPermisosDelUsuario(session.user.id),
      ]);

      const asignacionesPorEmpresa = normalizarAsignaciones(filasRoles);
      const empresaActualId = elegirEmpresaActiva(asignacionesPorEmpresa, usuario?.empresa_id ?? null);

      this._usuarioAuthResueltoId = session.user.id;
      this._store.setState({
        estado: 'autenticado',
        usuario,
        asignacionesPorEmpresa,
        empresaActualId,
      });

      logger.info('Sesión resuelta', { usuarioId: session.user.id, empresaActualId });
      eventBus.emit(eventoAEmitir, { usuarioId: session.user.id, empresaActualId });
    } catch (error) {
      logger.error('Fallo al resolver sesión', { error: String(error) });
      this._store.setState({ estado: 'error' });
      eventBus.emit(AUTH_EVENTS.SESSION_RESOLUTION_FAILED, { error: String(error) });
      throw error;
    }
  }
}

export default AuthService;
