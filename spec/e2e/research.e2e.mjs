/**
 * @file spec/e2e/research.e2e.mjs
 * @description Prueba de navegador del Módulo 10: plataforma de investigación (cohortes, consentimientos, exportación CSV anónima)
 * 
 * con Supabase simulado.
 *
 * Ejecutar:  node spec/e2e/research.e2e.mjs
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
const paso = (n) => console.log(`  ✓ ${n}`);
pagina.on('pageerror', (e) => errores.push(String(e)));
pagina.on('console', (m) => m.type() === 'error' && !/favicon|manifest|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text()) && errores.push(m.text()));

function semilla(db) {
  const A = 'c1000000-0000-4000-8000-00000000000a';
  const AREA = 'd1000000-0000-4000-8000-000000000001';
  db.areas.push({ id: AREA, empresa_id: A, nombre: 'Mantenimiento', estado: 'activo' });
  for (let i = 1; i <= 6; i += 1) {
    db.operadores.push({ id: `b100000${i}-0000-4000-8000-00000000000${i}`, empresa_id: A, cedula: `90${i}`, nombre: `Op${i}`, apellido: `Ape${i}`, estado: 'activo', area_id: AREA, cargo_id: null });
  }
}

await pagina.addInitScript(
  `window.__E2E_PERMISOS__ = ['investigacion.acceder','datos.exportar','operadores.ver','operadores.administrar','catalogos.ver']; window.__E2E_SEED__ = ${semilla.toString()};`,
);
await pagina.route('**/js/env.js', (r) =>
  r.fulfill({ contentType: 'text/javascript', body: "window.__NEUROLAB_ENV__={SUPABASE_URL:'https://e2e.supabase.co',SUPABASE_ANON_KEY:'e2e',APP_ENV:'development',LOG_LEVEL:'error'};" }),
);
await pagina.route('https://esm.sh/**', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE_SOURCE }));
const css = (v) => pagina.evaluate((x) => document.documentElement.style.getPropertyValue(x), v);
const db = (expr) => pagina.evaluate(`(${expr})(window.__fakeDb)`);


const entrar = async () => {
  await pagina.goto(`${base}/#/`);
  await pagina.waitForSelector('#login-form');
  await pagina.fill('input[name=email]', 'a@x.co');
  await pagina.fill('input[name=password]', 'secreto');
  await pagina.click('[data-submit]');
  await pagina.waitForSelector('#app-menu a');
};

try {
  await entrar();
  assert.ok((await pagina.$$eval('#app-menu a', (as) => as.map((a) => a.textContent))).includes('Investigación'));
  await pagina.click('#app-menu a[href="#/investigacion"]');
  await pagina.waitForSelector('h1:text("Investigación")');
  await pagina.waitForSelector('text=Aún no hay cohortes.');
  await pagina.waitForSelector('td:text("Op1 Ape1 (901)")');
  assert.equal(await pagina.locator('td:text("Sin registro")').count(), 6);
  paso('menú, cohortes vacías y operadores sin consentimiento de investigación');

  // Consentimientos: 5 de 6 operadores consienten (el 6.º no)
  for (let i = 1; i <= 5; i += 1) {
    await pagina.click(`tr:has-text("(90${i})") >> text=Registrar consentimiento`);
    await pagina.fill('dialog input[name=documento]', 'javascript:alert(1)');
    await pagina.click('dialog button[type=submit]');
    await pagina.waitForSelector('dialog .form-error:not([hidden]):text("https://")');
    await pagina.fill('dialog input[name=documento]', '');
    await pagina.click('dialog button[type=submit]');
    await pagina.waitForSelector('dialog', { state: 'detached' });
    await pagina.waitForSelector(`tr:has-text("(90${i})") >> text=Otorgado`);
  }
  assert.equal(await db('(d) => d.consentimientos.length'), 5);
  assert.equal(await db('(d) => d.consentimientos.every((c) => c.proposito === "investigacion_cientifica")'), true);
  paso('consentimiento de investigación: validación https, registro por operador');

  // Cohorte con criterio de área; poblar; exportar
  await pagina.click('button:text("Nueva cohorte")');
  await pagina.fill('dialog input[name=nombre]', 'Mantenimiento 2026');
  await pagina.selectOption('dialog select[name=area]', { label: 'Mantenimiento' });
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog', { state: 'detached' });
  await pagina.waitForSelector('td:text("Mantenimiento 2026")');
  assert.equal(await pagina.locator('tr:has-text("Mantenimiento 2026") td').nth(2).textContent(), '0');
  paso('cohorte creada con criterio de área');

  await pagina.click('button:text("Exportar CSV")');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog .form-error:not([hidden]):text("mínimo de 5")');
  await pagina.click('dialog button:text("Cancelar")');
  paso('exportar una cohorte sin participantes se rechaza con mensaje claro');

  await pagina.click('button:text("Incorporar con consentimiento")');
  await pagina.waitForSelector('text=5 operador(es) incorporado(s).');
  assert.equal(await pagina.locator('tr:has-text("Mantenimiento 2026") td').nth(2).textContent(), '5');
  assert.equal(await db('(d) => d.cohortes_operadores.some((m) => m.operador_id === "b1000006-0000-4000-8000-000000000006")'), false);
  paso('solo entran los 5 operadores con consentimiento (el 6.º queda fuera)');

  await pagina.click('button:text("Exportar CSV")');
  const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.click('dialog button[type=submit]')]);
  assert.match(descarga.suggestedFilename(), /^neurolab-dataset-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.csv$/);
  const csv = await readFile(await descarga.path(), 'utf8');
  assert.ok(csv.startsWith('\uFEFFparticipante,fecha,turno,prueba'));
  assert.equal(csv.trim().split('\r\n').length, 6);
  assert.ok(!/90\d|Op\d|Ape\d/.test(csv), 'el CSV no contiene cédula ni nombres');
  await pagina.waitForSelector('text=Exportación lista: 5 filas de 5 participantes.');
  assert.equal(await db('(d) => d.auditoria.filter((a) => a.accion === "dataset.exportar").length'), 1);
  paso('exportación CSV anónima descargada y auditada');

  // Revocar: baja de participantes y sale de la cohorte (comportamiento de la BD simulado: la UI refresca)
  await pagina.click('tr:has-text("(901)") >> text=Revocar consentimiento');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog', { state: 'detached' });
  await pagina.waitForSelector('tr:has-text("(901)") >> text=Revocado');
  assert.deepEqual(await db('(d) => d.consentimientos.filter((c) => c.operador_id === "b1000001-0000-4000-8000-000000000001").map((c) => c.otorgado)'), [true, false]);
  paso('revocar agrega una fila al historial (no edita la anterior)');

  await pagina.click('tr:has-text("Mantenimiento 2026") >> text=Eliminar');
  await pagina.click('dialog button.button-danger');
  await pagina.waitForSelector('text=Aún no hay cohortes.');
  paso('eliminar cohorte');

  assert.deepEqual(errores, [], `Errores de consola/página: ${errores.join(' | ')}`);
  paso('sin errores de consola');
  console.log('E2E RESEARCH: OK');
} catch (error) {
  console.error('DOM:', (await pagina.textContent('#app-view').catch(() => '')).slice(0, 600));
  console.error('E2E FALLÓ:', error.message, '\nErrores de consola:', errores);
  process.exitCode = 1;
} finally {
  await navegador.close();
  servidor.close();
}
