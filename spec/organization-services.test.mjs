/**
 * @file spec/organization-services.test.mjs
 * @description Pruebas de CatalogosService y OperadoresService con repositorios falsos.
 * Ejecutar: node --test spec/organization-services.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogosService, normalizarNombre } from '../services/catalogos-service.js';
import { OperadoresService, normalizarCedula, validarOperador } from '../services/operadores-service.js';
import { OrganizationError, traducirErrorDatos } from '../services/organization-error.js';
import { RepositoryError } from '../js/repositories/repository-error.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const formularioValido = (extra = {}) => ({ cedula: '1.090.123.456', nombre: ' Ana  María ', apellido: 'Pérez', ...extra });

test('normalizarNombre recorta, colapsa espacios y valida longitud', () => {
  assert.equal(normalizarNombre('  Sala   de  mandos '), 'Sala de mandos');
  assert.throws(() => normalizarNombre('   '), (e) => e.codigo === 'validacion' && e.campo === 'nombre');
  assert.throws(() => normalizarNombre('x'.repeat(121)), OrganizationError);
  assert.throws(() => normalizarNombre(null), OrganizationError);
});

test('CatalogosService.crear normaliza y delega; rechaza catálogo desconocido', async () => {
  const llamadas = [];
  const servicio = new CatalogosService({ catalogos: { crear: async (c, d) => (llamadas.push([c, d]), { id: 'x' }) } });
  await servicio.crear('areas', 'e1', { nombre: '  Calderas ' });
  assert.deepEqual(llamadas[0], ['areas', { empresaId: 'e1', nombre: 'Calderas', padreId: null }]);
  await assert.rejects(() => servicio.crear('usuarios', 'e1', { nombre: 'x' }), (e) => e.codigo === 'validacion');
  assert.equal(llamadas.length, 1);
});

test('CatalogosService mapea 23505 a duplicado y 23503 a referencia_invalida', async () => {
  const falla = (code) => async () => { throw new RepositoryError('op', { code, message: 'x' }); };
  const dup = new CatalogosService({ catalogos: { crear: falla('23505') } });
  await assert.rejects(() => dup.crear('areas', 'e1', { nombre: 'A' }), (e) => e.codigo === 'duplicado');
  const ref = new CatalogosService({ catalogos: { crear: falla('23503') } });
  await assert.rejects(() => ref.crear('cargos', 'e1', { nombre: 'A', padreId: UUID }), (e) => e.codigo === 'referencia_invalida');
});

test('CatalogosService.actualizar valida estado y exige algún cambio', async () => {
  const servicio = new CatalogosService({ catalogos: { actualizar: async () => ({}) } });
  await assert.rejects(() => servicio.actualizar('areas', UUID, { estado: 'borrado' }), (e) => e.campo === 'estado');
  await assert.rejects(() => servicio.actualizar('areas', UUID, {}), OrganizationError);
  await servicio.desactivar('areas', UUID);
});

test('normalizarCedula acepta separadores y rechaza no numéricas', () => {
  assert.equal(normalizarCedula('1.090.123.456'), '1090123456');
  assert.equal(normalizarCedula(12345), '12345');
  for (const mala of ['abc', '1234', '1234567890123', '', null, '12a45']) {
    assert.throws(() => normalizarCedula(mala), (e) => e.campo === 'cedula', String(mala));
  }
});

test('validarOperador convierte a columnas y valida relaciones', () => {
  const datos = validarOperador(formularioValido({ cargoId: UUID, turnoHabitual: 'Noche' }));
  assert.equal(datos.nombre, 'Ana María');
  assert.equal(datos.cargo_id, UUID);
  assert.equal(datos.area_id, null);
  assert.equal(datos.turno_habitual, 'Noche');
  assert.throws(() => validarOperador(formularioValido({ cargoId: "1' or '1'='1" })), (e) => e.campo === 'cargoId');
  assert.throws(() => validarOperador(formularioValido({ nombre: '' })), (e) => e.campo === 'nombre');
  assert.throws(() => validarOperador(formularioValido({ turnoHabitual: 'x'.repeat(61) })), (e) => e.campo === 'turnoHabitual');
});

test('OperadoresService.crear añade empresa_id y mapea cédula duplicada', async () => {
  let recibido;
  const ok = new OperadoresService({ operadores: { crear: async (d) => ((recibido = d), { id: 'o1' }) } });
  await ok.crear('e1', formularioValido());
  assert.equal(recibido.empresa_id, 'e1');
  assert.equal(recibido.cedula, '1090123456');

  const dup = new OperadoresService({ operadores: { crear: async () => { throw new RepositoryError('o', { code: '23505' }); } } });
  await assert.rejects(() => dup.crear('e1', formularioValido()), (e) => e.codigo === 'duplicado');
});

test('OperadoresService.anonimizar exige confirmación explícita', async () => {
  let actualizado = false;
  const repo = {
    obtener: async () => ({ id: UUID, estado: 'activo' }),
    actualizar: async () => { actualizado = true; return { id: UUID }; },
  };
  const servicio = new OperadoresService({ operadores: repo });
  await assert.rejects(() => servicio.anonimizar(UUID), (e) => e.codigo === 'operacion_no_permitida');
  await assert.rejects(() => servicio.anonimizar(UUID, { confirmar: 'true' }), OrganizationError);
  assert.equal(actualizado, false);
  await servicio.anonimizar(UUID, { confirmar: true });
  assert.equal(actualizado, true);
});

test('OperadoresService no modifica ni reactiva operadores anonimizados', async () => {
  const repo = { obtener: async () => ({ id: UUID, estado: 'anonimizado' }), actualizar: async () => assert.fail('no debe escribir') };
  const servicio = new OperadoresService({ operadores: repo });
  await assert.rejects(() => servicio.actualizar(UUID, formularioValido()), (e) => e.codigo === 'operacion_no_permitida');
  await assert.rejects(() => servicio.activar(UUID), (e) => e.codigo === 'operacion_no_permitida');
  assert.deepEqual(await servicio.anonimizar(UUID, { confirmar: true }), { id: UUID });
});

test('operador inexistente (o fuera de RLS) produce no_encontrado', async () => {
  const servicio = new OperadoresService({ operadores: { obtener: async () => null } });
  await assert.rejects(() => servicio.desactivar(UUID), (e) => e.codigo === 'no_encontrado');
});

test('traducirErrorDatos: PGRST116, 42501 y desconocidos', () => {
  assert.equal(traducirErrorDatos(new RepositoryError('x', { code: 'PGRST116' })).codigo, 'no_encontrado');
  assert.equal(traducirErrorDatos(new RepositoryError('x', { code: '42501' })).codigo, 'sin_permiso');
  const e = traducirErrorDatos(new Error('boom'));
  assert.equal(e.codigo, 'desconocido');
  assert.ok(!e.message.includes('boom'));
});
