/**
 * @file spec/auth-service.test.mjs
 * @description Pruebas unitarias de `services/auth-service.js`.
 *
 * Cubre (1) las funciones puras `normalizarAsignaciones` / `elegirEmpresaActiva`
 * y (2) `AuthService` con un cliente Supabase y un repositorio falsos
 * inyectados por constructor (sin red, sin DOM).
 *
 * Ejecutar: node --test spec/auth-service.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, AuthError, normalizarAsignaciones, elegirEmpresaActiva } from '../services/auth-service.js';
import { setGlobalLogLevel } from '../services/logger.js';

// Silencia el logger durante las pruebas.
setGlobalLogLevel('error');

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

test('normalizarAsignaciones: fila sin rol se ignora sin lanzar error', () => {
  const resultado = normalizarAsignaciones([{ empresa_id: 'e1', empresas: { nombre: 'E1' }, roles: null }]);
  assert.deepEqual(resultado, {});
});

test('normalizarAsignaciones: input vacío o indefinido devuelve objeto vacío', () => {
  assert.deepEqual(normalizarAsignaciones([]), {});
  assert.deepEqual(normalizarAsignaciones(undefined), {});
});

test('normalizarAsignaciones: agrupa permisos de un rol en un Set por empresa', () => {
  const resultado = normalizarAsignaciones([
    {
      empresa_id: 'empresa-1',
      empresas: { nombre: 'Termotasajero' },
      roles: {
        nombre: 'Supervisor SST',
        roles_permisos: [{ permisos: { codigo: 'evaluaciones.ver' } }, { permisos: { codigo: 'datos.exportar' } }],
      },
    },
  ]);

  assert.equal(resultado['empresa-1'].empresaNombre, 'Termotasajero');
  assert.equal(resultado['empresa-1'].rolNombre, 'Supervisor SST');
  assert.equal(resultado['empresa-1'].permisos.has('evaluaciones.ver'), true);
  assert.equal(resultado['empresa-1'].permisos.has('datos.exportar'), true);
  assert.equal(resultado['empresa-1'].permisos.has('usuarios.administrar'), false);
});

test('normalizarAsignaciones: permisos con relación nula se descartan', () => {
  const resultado = normalizarAsignaciones([
    {
      empresa_id: 'e1',
      empresas: { nombre: 'E1' },
      roles: { nombre: 'Operador', roles_permisos: [{ permisos: null }, { permisos: { codigo: 'evaluaciones.registrar' } }] },
    },
  ]);
  assert.equal(resultado.e1.permisos.size, 1);
  assert.equal(resultado.e1.permisos.has('evaluaciones.registrar'), true);
});

test('normalizarAsignaciones: sin nombre de empresa usa el id como respaldo', () => {
  const resultado = normalizarAsignaciones([{ empresa_id: 'x', empresas: null, roles: { nombre: 'Operador', roles_permisos: [] } }]);
  assert.equal(resultado.x.empresaNombre, 'x');
});

test('normalizarAsignaciones: dos empresas producen entradas independientes', () => {
  const resultado = normalizarAsignaciones([
    { empresa_id: 'e1', empresas: { nombre: 'E1' }, roles: { nombre: 'Profesional PGR', roles_permisos: [{ permisos: { codigo: 'evaluaciones.ver' } }] } },
    { empresa_id: 'e2', empresas: { nombre: 'E2' }, roles: { nombre: 'Administrador de empresa', roles_permisos: [{ permisos: { codigo: 'usuarios.administrar' } }] } },
  ]);
  assert.equal(Object.keys(resultado).length, 2);
  assert.equal(resultado.e1.permisos.has('usuarios.administrar'), false);
  assert.equal(resultado.e2.permisos.has('usuarios.administrar'), true);
});

test('elegirEmpresaActiva: sin asignaciones devuelve null', () => {
  assert.equal(elegirEmpresaActiva({}, 'home'), null);
  assert.equal(elegirEmpresaActiva({}, null), null);
});

test('elegirEmpresaActiva: prioriza la empresa home si tiene asignación', () => {
  const asignaciones = { home: {}, otra: {} };
  assert.equal(elegirEmpresaActiva(asignaciones, 'home'), 'home');
});

test('elegirEmpresaActiva: sin asignación en home cae al primer id en orden alfabético', () => {
  assert.equal(elegirEmpresaActiva({ zzz: {}, aaa: {} }, 'inexistente'), 'aaa');
  assert.equal(elegirEmpresaActiva({ zzz: {}, aaa: {} }, null), 'aaa');
});

// ---------------------------------------------------------------------------
// AuthService con dobles inyectados
// ---------------------------------------------------------------------------

const FILA_ADMIN = {
  empresa_id: 'emp-1',
  empresas: { nombre: 'Termotasajero' },
  roles: { nombre: 'Administrador de empresa', roles_permisos: [{ permisos: { codigo: 'usuarios.administrar' } }] },
};

/** Crea un AuthService con cliente y repositorio falsos. */
function crearServicio({ signInResult, perfil, filas, session = null } = {}) {
  const llamadas = { signOut: 0 };
  const supabaseClient = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async () => signInResult,
      signOut: async () => {
        llamadas.signOut += 1;
        return { error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
  const usuariosRepository = {
    obtenerPerfilCompleto: async () => perfil,
    listarRolesYPermisosDelUsuario: async () => filas ?? [],
  };
  return { servicio: new AuthService({ supabaseClient, usuariosRepository }), llamadas };
}

const SESION_VALIDA = { user: { id: 'u1' } };

test('AuthService: el constructor exige sus dependencias', () => {
  assert.throws(() => new AuthService({}), TypeError);
  assert.throws(() => new AuthService({ supabaseClient: {} }), TypeError);
});

test('AuthService.init: sin sesión persistida queda en estado "anonimo"', async () => {
  const { servicio } = crearServicio();
  await servicio.init();
  assert.equal(servicio.sessionStore.getState().estado, 'anonimo');
  assert.equal(servicio.estaAutenticado(), false);
});

test('AuthService.init: con sesión persistida resuelve usuario y permisos', async () => {
  const { servicio } = crearServicio({
    session: SESION_VALIDA,
    perfil: { id: 'u1', empresa_id: 'emp-1', nombre_completo: 'Admin', email: 'a@x.co', estado: 'activo' },
    filas: [FILA_ADMIN],
  });
  await servicio.init();
  assert.equal(servicio.estaAutenticado(), true);
  assert.equal(servicio.sessionStore.getState().empresaActualId, 'emp-1');
  assert.equal(servicio.tienePermiso('usuarios.administrar'), true);
  assert.equal(servicio.tienePermiso('configuracion.editar'), false);
});

test('AuthService.login: credenciales inválidas lanzan AuthError con mensaje genérico', async () => {
  const { servicio } = crearServicio({ signInResult: { data: {}, error: { status: 400, message: 'Invalid login credentials' } } });
  await assert.rejects(
    () => servicio.login('a@x.co', 'mala'),
    (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.message, 'Correo o contraseña incorrectos.');
      return true;
    }
  );
  assert.equal(servicio.estaAutenticado(), false);
});

test('AuthService.login: éxito deja la sesión autenticada con permisos de la empresa', async () => {
  const { servicio } = crearServicio({
    signInResult: { data: { session: SESION_VALIDA }, error: null },
    perfil: { id: 'u1', empresa_id: 'emp-1', nombre_completo: 'Admin', email: 'a@x.co', estado: 'activo' },
    filas: [FILA_ADMIN],
  });
  await servicio.login('a@x.co', 'ok');
  assert.equal(servicio.estaAutenticado(), true);
  assert.equal(servicio.tienePermiso('usuarios.administrar'), true);
});

test('AuthService.login: usuario inactivo cierra sesión y lanza AuthError', async () => {
  const { servicio, llamadas } = crearServicio({
    signInResult: { data: { session: SESION_VALIDA }, error: null },
    perfil: { id: 'u1', empresa_id: 'emp-1', nombre_completo: 'Baja', email: 'b@x.co', estado: 'inactivo' },
    filas: [FILA_ADMIN],
  });
  await assert.rejects(() => servicio.login('b@x.co', 'ok'), AuthError);
  assert.equal(llamadas.signOut, 1);
  assert.equal(servicio.estaAutenticado(), false);
});

test('AuthService.logout: deja el estado en "anonimo" y sin permisos', async () => {
  const { servicio } = crearServicio({
    signInResult: { data: { session: SESION_VALIDA }, error: null },
    perfil: { id: 'u1', empresa_id: 'emp-1', nombre_completo: 'Admin', email: 'a@x.co', estado: 'activo' },
    filas: [FILA_ADMIN],
  });
  await servicio.login('a@x.co', 'ok');
  await servicio.logout();
  assert.equal(servicio.sessionStore.getState().estado, 'anonimo');
  assert.equal(servicio.tienePermiso('usuarios.administrar'), false);
});

test('AuthService.cambiarEmpresaActiva: rechaza empresas sin asignación y cambia permisos al cambiar', async () => {
  const { servicio } = crearServicio({
    signInResult: { data: { session: SESION_VALIDA }, error: null },
    perfil: { id: 'u1', empresa_id: 'emp-1', nombre_completo: 'Multi', email: 'm@x.co', estado: 'activo' },
    filas: [
      FILA_ADMIN,
      { empresa_id: 'emp-2', empresas: { nombre: 'Otra' }, roles: { nombre: 'Profesional PGR', roles_permisos: [{ permisos: { codigo: 'evaluaciones.ver' } }] } },
    ],
  });
  await servicio.login('m@x.co', 'ok');

  assert.throws(() => servicio.cambiarEmpresaActiva('emp-inexistente'), RangeError);
  assert.equal(servicio.tienePermiso('usuarios.administrar'), true);

  servicio.cambiarEmpresaActiva('emp-2');
  assert.equal(servicio.tienePermiso('usuarios.administrar'), false);
  assert.equal(servicio.tienePermiso('evaluaciones.ver'), true);
});

test('AuthService: fallo del repositorio deja estado "error" y propaga el error', async () => {
  const { servicio } = crearServicio({ signInResult: { data: { session: SESION_VALIDA }, error: null } });
  servicio._usuariosRepository.obtenerPerfilCompleto = async () => {
    throw new Error('red caída');
  };
  await assert.rejects(() => servicio.login('a@x.co', 'ok'), /red caída/);
  assert.equal(servicio.sessionStore.getState().estado, 'error');
});
