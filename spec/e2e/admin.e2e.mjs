/**
 * @file spec/e2e/admin.e2e.mjs
 * @description Prueba de navegador del Módulo 7: configuración de empresa
 * (marca, turnos, pruebas, pesos, baremo), reglas con constructor visual,
 * bandeja de alertas y visor de auditoría — con Supabase simulado.
 *
 * Ejecutar:  node spec/e2e/admin.e2e.mjs
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
  const v = (id, funcion) => ({ id, numero_version: 1, funcion_puntuacion: funcion, parametros: {}, estado: 'experimental' });
  db.pruebas.push(
    { id: 'p1', codigo: 'atencion_cancelacion', nombre: 'Atención', categoria: 'atencion', estado: 'activa', version_actual: v('v1', 'x') },
    { id: 'p2', codigo: 'stroop_adaptado', nombre: 'Stroop', categoria: 'inhibicion', estado: 'activa', version_actual: v('v2', 'x') },
  );
  db.reglas.push({ id: 'g1', empresa_id: null, nombre: 'ICO crítico', condicion: { indicador: 'ico', op: '<', valor: 50 }, severidad: 'roja', mensaje_plantilla: 'x', estado: 'activa' });
  db.alertas.push(
    { id: 'a7000000-0000-4000-8000-000000000001', empresa_id: A, regla_id: 'g1', operador_id: 'o1', evaluacion_id: 'e1', severidad: 'roja', mensaje: 'ICO de Ana en 40, por debajo de 50.', estado: 'abierta', created_at: '2026-10-15T15:00:00Z' },
    { id: 'a7000000-0000-4000-8000-000000000002', empresa_id: A, regla_id: 'g1', operador_id: 'o2', evaluacion_id: 'e2', severidad: 'amarilla', mensaje: 'Segunda alerta <b>negrita</b>', estado: 'abierta', created_at: '2026-10-15T16:00:00Z' },
  );
  db.auditoria.push(
    { id: 'au1', empresa_id: A, usuario_id: 'u1', accion: 'configuracion_empresa.update', entidad: 'configuracion_empresa', entidad_id: A, detalle_anterior: { turnos: [] }, detalle_nuevo: { turnos: ['<img src=x onerror=alert(1)>'] }, ip: '203.0.113.9', created_at: '2026-10-15T12:00:00Z' },
  );
}

await pagina.addInitScript(
  `window.__E2E_PERMISOS__ = ['configuracion.editar','evaluaciones.ver','alertas.gestionar','auditoria.ver']; window.__E2E_SEED__ = ${semilla.toString()};`,
);
await pagina.route('**/js/env.js', (r) =>
  r.fulfill({ contentType: 'text/javascript', body: "window.__NEUROLAB_ENV__={SUPABASE_URL:'https://e2e.supabase.co',SUPABASE_ANON_KEY:'e2e',APP_ENV:'development',LOG_LEVEL:'error'};" }),
);
await pagina.route('https://esm.sh/**', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE_SOURCE }));
const css = (v) => pagina.evaluate((x) => document.documentElement.style.getPropertyValue(x), v);
const db = (expr) => pagina.evaluate(`(${expr})(window.__fakeDb)`);

try {
  await pagina.goto(`${base}/#/`);
  await pagina.waitForSelector('#login-form');
  await pagina.fill('input[name=email]', 'a@x.co');
  await pagina.fill('input[name=password]', 'secreto');
  await pagina.click('[data-submit]');
  await pagina.waitForSelector('#app-menu a');
  assert.deepEqual(await pagina.$$eval('#app-menu a', (as) => as.map((a) => a.textContent)), ['Inicio', 'Dashboard operativo', 'Dashboard clínico', 'Dashboard ejecutivo', 'Alertas', 'Configuración', 'Reglas', 'Auditoría']);
  paso('menú según permisos (configuración, reglas, alertas, auditoría)');

  // ------------------------------------------------------------ configuración
  await pagina.click('#app-menu a[href="#/admin/configuracion"]');
  await pagina.waitForSelector('input[name=color_primario]');
  await pagina.fill('input[name=color_primario]', 'red;background:url(x)');
  await pagina.click('button:text("Guardar configuración")');
  await pagina.waitForSelector('.config-form .form-error:text("Color inválido")');
  assert.equal(await db('(d) => d.configuracion_empresa[0].marca.color_primario'), '#ff0000');
  paso('color con inyección CSS rechazado y no persistido');

  await pagina.fill('input[name=color_primario]', '#00FF00');
  await pagina.click('button:text("Agregar turno")');
  await pagina.fill('input[name=turno_nombre]', 'Diurno');
  await pagina.check('input[name=prueba][value=stroop_adaptado]');
  await pagina.selectOption('select[name=baremo_modalidad]', 'institucional');
  await pagina.click('button:text("Guardar configuración")');
  await pagina.waitForSelector('text=Cambios guardados.');
  const guardada = await db('(d) => d.configuracion_empresa[0]');
  assert.equal(guardada.marca.color_primario, '#00ff00');
  assert.deepEqual(guardada.turnos, [{ nombre: 'Diurno', hora_inicio: '06:00', hora_fin: '18:00' }]);
  assert.deepEqual(guardada.pruebas_activas, ['stroop_adaptado']);
  assert.equal(guardada.baremo_modalidad, 'institucional');
  assert.equal(await css('--color-primario'), '#00ff00');
  paso('configuración general guardada y marca aplicada al instante');

  await pagina.fill('input[name=peso_atencion_cancelacion]', '');
  await pagina.click('button:text("Publicar pesos")');
  await pagina.waitForSelector('.config-form .form-error:text("Peso inválido")');
  await pagina.fill('input[name=peso_atencion_cancelacion]', '2');
  await pagina.click('button:text("Publicar pesos")');
  await pagina.waitForFunction(() => window.__fakeDb.ico_configuraciones.length === 1);
  assert.deepEqual(await db('(d) => d.ico_configuraciones[0].pesos'), { atencion_cancelacion: 2, stroop_adaptado: 1 });
  paso('pesos del ICO: validación y publicación de versión nueva');

  await pagina.fill('input[name=excelente]', '40');
  await pagina.click('button:text("Publicar baremo")');
  await pagina.waitForSelector('.config-form .form-error:text("no puede ser menor")');
  await pagina.fill('input[name=excelente]', '80');
  await pagina.fill('input[name=atencion]', '55');
  await pagina.click('button:text("Publicar baremo")');
  await pagina.waitForFunction(() => window.__fakeDb.baremos.length === 1);
  const baremo = await db('(d) => d.baremos[0]');
  assert.equal(baremo.modalidad, 'institucional');
  assert.deepEqual(baremo.parametros, { direccion: 'mayor_mejor', umbrales: { excelente: 80, atencion: 55 } });
  paso('baremo institucional: coherencia de umbrales y dirección mayor_mejor');

  // ------------------------------------------------------------------- reglas
  await pagina.click('#app-menu a[href="#/admin/reglas"]');
  await pagina.waitForSelector('td:text("ICO crítico")');
  assert.equal(await pagina.locator('tr:has-text("ICO crítico") >> text=Desactivar').count(), 0);
  paso('las reglas globales no se pueden desactivar desde la empresa');

  await pagina.click('button:text("Nueva regla")');
  await pagina.fill('dialog input[name=nombre]', 'Reacción lenta');
  await pagina.fill('dialog input[name=mensaje]', 'Revisar a {operador} ({umbral})');
  await pagina.selectOption('dialog select[name=indicador]', 'reaccion_simple.tiempo');
  await pagina.selectOption('dialog select[name=tipo]', 'percentil');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog [role=alert]:not([hidden])'); // falta el número
  await pagina.fill('dialog input[name=numero]', '90');
  await pagina.selectOption('dialog select[name=severidad]', 'naranja');
  await pagina.click('dialog button[type=submit]');
  await pagina.waitForSelector('dialog', { state: 'detached' });
  await pagina.waitForSelector('td:text("Reacción lenta")');
  assert.deepEqual(await db('(d) => d.reglas.find((r) => r.nombre === "Reacción lenta").condicion'), { indicador: 'reaccion_simple.tiempo', op: '<', percentil: 90 });
  paso('regla creada con el constructor (condición estructurada, sin texto libre)');

  await pagina.click('tr:has-text("Reacción lenta") >> text=Desactivar');
  await pagina.waitForSelector('tr:has-text("Reacción lenta") >> text=Inactiva');
  paso('desactivar regla de la empresa');

  // ------------------------------------------------------------------ alertas
  await pagina.click('#app-menu a[href="#/alertas"]');
  await pagina.waitForSelector('td:text("ICO de Ana en 40")');
  assert.equal(await pagina.locator('tbody tr').count(), 2);
  assert.equal(await pagina.locator('td b').count(), 0, 'el mensaje se muestra como texto, no como HTML');
  await pagina.click('tr:has-text("ICO de Ana") >> text=Atender');
  await pagina.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  assert.equal(await db('(d) => d.alertas.find((a) => a.id === "a7000000-0000-4000-8000-000000000001").estado'), 'atendida');
  await pagina.selectOption('select[name=estado]', '');
  await pagina.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
  assert.ok((await pagina.textContent('tr:has-text("ICO de Ana")')).includes('Atendida'));
  paso('bandeja de alertas: filtrar, atender y mensajes como texto');

  // ----------------------------------------------------------------- auditoría
  await pagina.click('#app-menu a[href="#/admin/auditoria"]');
  await pagina.waitForSelector('td:text("configuracion_empresa.update")');
  await pagina.click('summary');
  assert.equal(await pagina.locator('.audit-json img').count(), 0, 'el detalle nunca se interpreta como HTML');
  assert.ok((await pagina.textContent('.audit-json >> nth=1')).includes('<img src=x onerror=alert(1)>'));
  paso('auditoría: detalle mostrado como texto');

  assert.deepEqual(errores, [], `Errores de consola/página: ${errores.join(' | ')}`);
  paso('sin errores de consola');
  console.log('E2E ADMIN: OK');
} catch (error) {
  console.error('DOM:', (await pagina.textContent('#app-view').catch(() => '')).slice(0, 500));
  console.error('E2E FALLÓ:', error.message, '\nErrores de consola:', errores);
  process.exitCode = 1;
} finally {
  await navegador.close();
  servidor.close();
}
