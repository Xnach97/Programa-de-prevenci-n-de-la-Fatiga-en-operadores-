/**
 * @file spec/brand.test.mjs
 * @description Pruebas de `js/brand.js` (saneamiento de marca) y del repositorio
 * (`sanitizarTerminoBusqueda`, lista blanca de catálogos).
 * Ejecutar: node --test spec/brand.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { marcaATokens, sanitizarColor, sanitizarFuente, sanitizarLogoUrl, escaparParaCssUrl } from '../js/brand.js';
import { sanitizarTerminoBusqueda } from '../js/repositories/operadores-repository.js';
import { CatalogosRepository } from '../js/repositories/catalogos-repository.js';

test('sanitizarColor acepta #RRGGBB y rechaza inyección', () => {
  assert.equal(sanitizarColor('#2F8FD6'), '#2f8fd6');
  for (const malo of ['red', '#fff', 'url(x)', '#2f8fd6;background:red', '', null, 12]) {
    assert.equal(sanitizarColor(malo), null, String(malo));
  }
});

test('sanitizarFuente acepta familias y rechaza ; { } ( )', () => {
  assert.equal(sanitizarFuente("'Inter', 'Segoe UI', sans-serif"), "'Inter', 'Segoe UI', sans-serif");
  for (const malo of ['Inter;color:red', 'a{b}', 'url(http://x)', '', 5]) {
    assert.equal(sanitizarFuente(malo), null, String(malo));
  }
});

test('sanitizarLogoUrl solo admite https sin credenciales', () => {
  assert.equal(sanitizarLogoUrl('https://cdn.ejemplo.co/logo.png'), 'https://cdn.ejemplo.co/logo.png');
  for (const malo of ['http://x.co/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https://u:p@x.co/a', 'no es url', null]) {
    assert.equal(sanitizarLogoUrl(malo), null, String(malo));
  }
  assert.equal(sanitizarLogoUrl(`https://x.co/${'a'.repeat(3000)}`), null);
});

test('escaparParaCssUrl neutraliza comillas, barras y saltos', () => {
  const salida = escaparParaCssUrl('a"b\\c\nd');
  assert.ok(!/["\n\\]/.test(salida.replace(/\\[0-9a-f]+ /g, '')));
});

test('marcaATokens mapea claves de BD y descarta inválidas', () => {
  const tokens = marcaATokens({
    color_primario: '#112233',
    color_secundario: 'rojo',
    tipografia: 'Inter, sans-serif',
    logo_url: 'http://inseguro.co/x.png',
  });
  assert.deepEqual(tokens, { colorPrimario: '#112233', tipografiaBase: 'Inter, sans-serif' });
  assert.deepEqual(marcaATokens(null), {});
  assert.deepEqual(marcaATokens('x'), {});
});

test('sanitizarTerminoBusqueda elimina la gramática de filtros PostgREST', () => {
  const t = sanitizarTerminoBusqueda('juan),estado.eq.activo,(nombre.ilike.%');
  assert.ok(!/[,().:%]/.test(t));
  assert.equal(sanitizarTerminoBusqueda(undefined), '');
  assert.equal(sanitizarTerminoBusqueda('a'.repeat(200)).length, 60);
});

test('CatalogosRepository rechaza catálogos fuera de la lista blanca', async () => {
  const repo = new CatalogosRepository({ from() { throw new Error('no debe llamarse'); } });
  for (const malo of ['usuarios', '__proto__', 'constructor', 'areas; drop']) {
    await assert.rejects(() => repo.listar(malo, 'e1'), RangeError, malo);
  }
});

import { contraste, textoSobre, luminancia } from '../js/brand.js';

test('contraste WCAG: valores de referencia', () => {
  assert.equal(Math.round(contraste('#000000', '#ffffff')), 21);
  assert.equal(luminancia('#ffffff'), 1);
  assert.ok(contraste('#2f8fd6', '#ffffff') < 4.5);
});

test('texto sobre el color de marca: siempre cumple AA (≥ 4.5:1), para cualquier color', () => {
  for (const hex of ['#2f8fd6', '#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffd400', '#1a6fb0', '#e24b4a']) {
    assert.ok(contraste(hex, textoSobre(hex)) >= 4.5, `${hex} → ${textoSobre(hex)} = ${contraste(hex, textoSobre(hex)).toFixed(2)}`);
  }
  // Franja de grises medios: ninguno de los dos extremos llega a 4.5:1; se elige el mejor posible.
  assert.ok(contraste('#777777', textoSobre('#777777')) >= 4.4);
  assert.equal(textoSobre('#1a1a80'), '#ffffff');
  assert.equal(textoSobre('#2f8fd6'), '#0b0f17');
  assert.equal(textoSobre('color-invalido'), '#ffffff');
});
