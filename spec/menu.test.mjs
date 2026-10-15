/**
 * @file spec/menu.test.mjs
 * @description Pruebas de la lógica pura del menú (`entradasDeMenu`).
 * Ejecutar: node --test spec/menu.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { entradasDeMenu } from '../js/menu.js';

const rutas = [
  { path: '/catalogos', meta: { menu: { etiqueta: 'c', orden: 20 }, permiso: 'catalogos.ver' } },
  { path: '/operadores', meta: { menu: { etiqueta: 'o', orden: 10 }, permiso: 'operadores.ver' } },
  { path: '/', meta: { menu: { etiqueta: 'i', orden: 0 } } },
  { path: '/oculta', meta: {} },
  { path: '/login', meta: { publico: true } },
];

test('sin sesión no hay entradas', () => {
  assert.deepEqual(entradasDeMenu(rutas, { autenticado: false, tienePermiso: () => true }), []);
});

test('filtra por permiso y ordena por orden', () => {
  const todos = entradasDeMenu(rutas, { autenticado: true, tienePermiso: () => true });
  assert.deepEqual(todos.map((e) => e.path), ['/', '/operadores', '/catalogos']);
  const parcial = entradasDeMenu(rutas, { autenticado: true, tienePermiso: (c) => c === 'operadores.ver' });
  assert.deepEqual(parcial.map((e) => e.path), ['/', '/operadores']);
});
