/**
 * @file spec/e2e/organization.e2e.mjs
 * @description Prueba de navegador (Chromium real) del Módulo 3 con un
 * Supabase simulado. Recorre: login → menú → catálogos (alta, duplicado,
 * relación, desactivar) → operadores (validación, alta, búsqueda, anonimización
 * con confirmación) → cambio de empresa (aislamiento + marca saneada).
 *
 * Ejecutar:  node spec/e2e/organization.e2e.mjs
 * Requiere:  playwright y Chromium (PLAYWRIGHT_BROWSERS_PATH).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FAKE_SUPABASE_SOURCE } from './fake-supabase.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const servidor = http.createServer(async (req, res) => {
  try {
    const ruta = new URL(req.url, 'http://x').pathname;
    const archivo = normalize(join(RAIZ, ruta === '/' ? 'index.html' : ruta));
    if (!archivo.startsWith(RAIZ)) throw new Error('fuera de raíz');
    res.writeHead(200, { 'content-type': MIME[extname(archivo)] ?? 'application/octet-stream' });
    res.end(await readFile(archivo));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => servidor.listen(0, ok));
const base = `http://localhost:${servidor.address().port}`;

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pagina = await navegador.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
pagina.on('console', (m) => m.type() === 'error' && !/favicon|manifest|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text()) && errores.push(m.text()));
await pagina.route('**/js/env.js', (r) =>
  r.fulfill({
    contentType: 'text/javascript',
    body: "window.__NEUROLAB_ENV__={SUPABASE_URL:'https://e2e.supabase.co',SUPABASE_ANON_KEY:'e2e',APP_ENV:'development',LOG_LEVEL:'error'};",
  }),
);
await pagina.route('**/vendor/supabase-js.mjs', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE_SOURCE }));

const css = (variable) => pagina.evaluate((v) => document.documentElement.style.getPropertyValue(v), variable);
const paso = (nombre) => console.log(`  ✓ ${nombre}`);

try {
  // --- Login y menú -------------------------------------------------------
  await pagina.goto(`${base}/#/`);
  await pagina.waitForSelector('#login-form');
  await pagina.fill('input[name=email]', 'a@x.co');
  await pagina.fill('input[name=password]', 'secreto');
  await pagina.click('[data-submit]');
  await pagina.waitForSelector('#app-menu a');
  const menu = await pagina.$$eval('#app-menu a', (as) => as.map((a) => a.textContent));
  assert.deepEqual(menu, ['Inicio', 'Operadores', 'Catálogos']);
  assert.equal(await pagina.getAttribute('#app-menu a[aria-current=page]', 'href'), '#/');
  paso('login y menú filtrado por permisos');

  await pagina.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-primario') === '#ff0000');
  assert.match(await css('--logo-url'), /^url\("https:\/\/cdn\.example\.co\/a\.png"\)$/);
  paso('marca de la empresa A aplicada');

  // --- Catálogos ----------------------------------------------------------
  await pagina.click('#app-menu a[href="#/admin/catalogos"]');
  await pagina.waitForSelector('[role=tablist]');
  const crearEnCatalogo = async (nombre, padre) => {
    await pagina.click('text=Nuevo registro');
    await pagina.fill('dialog input[name=nombre]', nombre);
    if (padre) await pagina.selectOption('dialog select[name=padreId]', { label: padre });
    await pagina.click('dialog button[type=submit]');
  };
  await crearEnCatalogo('Calderas');
  await pagina.waitForSelector('dialog', { state: 'detached' });
  await pagina.waitForSelector('td:text("Calderas")');
  await pagina.click('text=Nuevo registro');
  await pagina.fill('dialog input[name=nombre]', '  calderas ');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog [role=alert]:not([hidden])');
  assert.match(await pagina.textContent('dialog [role=alert]'), /Ya existe/);
  await pagina.click('dialog >> text=Cancelar');
  paso('alta de área y rechazo de duplicado insensible a mayúsculas');

  await pagina.click('#tab-cargos');
  await crearEnCatalogo('Operador de caldera', 'Calderas');
  await pagina.waitForSelector('td:text("Operador de caldera")');
  assert.equal(await pagina.textContent('tbody tr td:nth-child(2)'), 'Calderas');
  paso('cargo asociado a área');

  await pagina.press('#tab-cargos', 'ArrowRight');
  assert.equal(await pagina.getAttribute('#tab-centros_trabajo', 'aria-selected'), 'true');
  paso('navegación por teclado entre pestañas');

  await pagina.click('#tab-areas');
  await pagina.waitForSelector('td:text("Calderas")');
  await pagina.click('tr:has-text("Calderas") >> text=Desactivar');
  await pagina.waitForSelector('tr:has-text("Calderas") >> text=Inactivo');
  paso('desactivar catálogo');

  // --- Operadores ---------------------------------------------------------
  await pagina.click('#app-menu a[href="#/operadores"]');
  await pagina.waitForSelector('text=No se encontraron operadores.');
  await pagina.click('text=Nuevo operador');
  assert.deepEqual(
    await pagina.$$eval('dialog select[name=cargoId] option', (o) => o.map((x) => x.textContent)),
    ['— Sin selección —', 'Operador de caldera'],
  );
  await pagina.fill('dialog input[name=cedula]', '12ab');
  await pagina.fill('dialog input[name=nombre]', 'Luis');
  await pagina.fill('dialog input[name=apellido]', 'Rojas');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog [role=alert]:not([hidden])');
  assert.match(await pagina.textContent('dialog [role=alert]'), /cédula/i);
  await pagina.fill('dialog input[name=cedula]', '1.090.123.456');
  await pagina.selectOption('dialog select[name=cargoId]', { label: 'Operador de caldera' });
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('td:text("1090123456")');
  paso('validación de cédula y alta de operador');

  await pagina.fill('input[name=busqueda]', 'zzz');
  await pagina.waitForSelector('text=No se encontraron operadores.');
  await pagina.fill('input[name=busqueda]', 'roj');
  await pagina.waitForSelector('td:text("1090123456")');
  paso('búsqueda con debounce');

  await pagina.click('text=Anonimizar');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog [role=alert]:not([hidden])');
  assert.match(await pagina.textContent('dialog [role=alert]'), /irreversible/);
  await pagina.check('dialog input[type=checkbox]');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog', { state: 'detached' });
  await pagina.fill('input[name=busqueda]', ''); // el término ya no coincide: la identidad fue eliminada
  await pagina.waitForSelector('text=Operador anonimizado');
  assert.equal(await pagina.locator('td:text("1090123456")').count(), 0);
  assert.equal(await pagina.locator('tr:has-text("Operador anonimizado") >> text=Editar').count(), 0);
  paso('anonimización exige confirmación y oculta identidad/acciones');

  // --- Cambio de empresa --------------------------------------------------
  await pagina.selectOption('select.session-controls__empresa', { label: 'Empresa B' });
  await pagina.waitForSelector('text=No se encontraron operadores.');
  await pagina.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-primario') === '#2f8fd6');
  // El logo con `')` queda contenido dentro de url("…"): no escapa de la cadena CSS.
  assert.equal(await css('--logo-url'), `url("https://x.co/a')")`);
  paso('cambio de empresa: datos aislados y color hostil descartado y logo contenido');

  // --- Cierre de sesión ---------------------------------------------------
  await pagina.click('.session-controls__logout');
  await pagina.waitForSelector('#login-form');
  assert.equal(await pagina.locator('#app-menu a').count(), 0);
  paso('logout limpia menú');

  assert.deepEqual(errores, [], `Errores de consola/página: ${errores.join(' | ')}`);
  paso('sin errores de consola');
  console.log('E2E ORGANIZATION: OK');
} catch (error) {
  await pagina.screenshot({ path: process.env.E2E_SCREENSHOT || '/tmp/e2e-fallo.png' }).catch(() => {});
  console.error('E2E FALLÓ:', error.message, '\nErrores de consola:', errores);
  process.exitCode = 1;
} finally {
  await navegador.close();
  servidor.close();
}
