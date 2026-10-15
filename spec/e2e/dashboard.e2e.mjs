/**
 * @file spec/e2e/dashboard.e2e.mjs
 * @description Prueba de navegador del Módulo 8: dashboards (operativo, clínico, ejecutivo, científico)
 * 
 * con indicadores precalculados y Supabase simulado.
 *
 * Ejecutar:  node spec/e2e/dashboard.e2e.mjs
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

const A = 'c1000000-0000-4000-8000-00000000000a';
const AREA = 'd1000000-0000-4000-8000-000000000001';
const CARGO = 'd2000000-0000-4000-8000-000000000001';
const OP1 = 'b1000000-0000-4000-8000-000000000001';
const OP2 = 'b1000000-0000-4000-8000-000000000002';
const OP3 = 'b1000000-0000-4000-8000-000000000003';
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const dia = (d) => new Date(Date.parse(HOY + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10);

function semilla(db) {
  const A = 'c1000000-0000-4000-8000-00000000000a';
  const AREA = 'd1000000-0000-4000-8000-000000000001';
  const CARGO = 'd2000000-0000-4000-8000-000000000001';
  const ops = ['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000003'];
  const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const dia = (d) => new Date(Date.parse(HOY + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10);
  db.areas.push({ id: AREA, empresa_id: A, nombre: 'Mantenimiento', estado: 'activo' });
  db.cargos.push({ id: CARGO, empresa_id: A, nombre: 'Maquinista', estado: 'activo', area_id: AREA });
  ['Ana Pérez', 'Beto Ruiz', 'Carla <b>X</b>'].forEach((n, i) => db.operadores.push({ id: ops[i], empresa_id: A, cedula: '10' + i, nombre: n.split(' ')[0], apellido: n.split(' ').slice(1).join(' '), estado: 'activo', area_id: AREA, cargo_id: CARGO }));
  const val = (codigo, ambito, desde, hasta, valor) => db.indicadores_valores.push({ indicador_id: 'def-' + codigo, empresa_id: A, ambito_id: ambito, periodo: '[' + desde + ',' + hasta + ')', valor, detalle: {}, calculado_en: new Date().toISOString() });
  const icos = [80, 45, 62];
  ops.forEach((o, i) => {
    val('ico_trabajador', o, dia(0), dia(1), icos[i]);
    val('indice_riesgo', o, dia(0), dia(1), i === 1 ? 2 : 0);
    val('indice_fatiga', o, dia(0), dia(1), 10 * i);
  });
  for (let d = -9; d <= 0; d++) if (d !== -4) val('ico_trabajador', ops[0], dia(d), dia(d + 1), 70 + d);
  val('ico_trabajador', ops[0], dia(-29), dia(1), 71); // periodo mensual: no debe entrar a la serie diaria
  [['indice_atencion', 75], ['indice_memoria', 60], ['indice_velocidad', 82]].forEach(([c, v]) => val(c, ops[0], dia(-29), dia(1), v)); // inhibición: sin dato
  val('ico_empresa', A, dia(0), dia(1), 62.3);
  val('indice_fatiga_empresa', A, dia(0), dia(1), 10);
  val('indice_riesgo_empresa', A, dia(0), dia(1), 0.7);
  val('ico_area', AREA, dia(0), dia(1), 62.3);
  val('ico_cargo', CARGO, dia(0), dia(1), 62.3);
  val('indice_riesgo_area', AREA, dia(0), dia(1), 0.7);
  for (let d = -9; d <= 0; d++) val('ico_empresa', A, dia(d), dia(d + 1), 60 + d / 2);
  db.alertas.push({ id: 'a7000000-0000-4000-8000-000000000001', empresa_id: A, regla_id: 'g', operador_id: ops[1], evaluacion_id: 'e1', severidad: 'roja', mensaje: 'm', estado: 'abierta', created_at: new Date().toISOString() });
  db.evaluaciones.push({ id: 'e1000000-0000-4000-8000-000000000001', empresa_id: A, operador_id: ops[0], fecha: new Date().toISOString() });
  db.recomendaciones_generadas.push({ id: 'f1', empresa_id: A, evaluacion_id: 'e1000000-0000-4000-8000-000000000001', plantilla_id: 'p', texto_resuelto: 'Pausa activa <i>de 10 minutos</i>.', created_at: new Date().toISOString() });
}

await pagina.addInitScript(
  `window.__E2E_PERMISOS__ = window.__PERMISOS_E2E__ || ['evaluaciones.ver','operadores.ver','investigacion.acceder']; window.__E2E_SEED__ = ${semilla.toString()};`,
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
  const menu = await pagina.$$eval('#app-menu a', (as) => as.map((a) => a.textContent));
  assert.ok(['Dashboard operativo', 'Dashboard clínico', 'Dashboard ejecutivo', 'Dashboard científico'].every((m) => menu.includes(m)), `menú: ${menu}`);
  paso('menú con los cuatro dashboards según permisos');

  // ---------------------------------------------------------------- operativo
  await pagina.click('#app-menu a[href="#/dashboard/operativo"]');
  await pagina.waitForSelector('.kpis');
  const kpis = await pagina.$$eval('.kpi__valor', (n) => n.map((x) => x.textContent));
  assert.deepEqual(kpis, ['3', '62.3', '1', '1']);
  await pagina.waitForSelector('svg[role=img]');
  assert.equal(await pagina.locator('table.table:not(.grafica__tabla) tbody tr').first().locator('td').first().textContent(), 'Beto Ruiz'); // ICO más bajo primero
  assert.equal(await pagina.locator('td b').count(), 0, 'nombres como texto');
  assert.ok((await pagina.textContent('table.table:not(.grafica__tabla) tbody')).includes('Carla <b>X</b>'));
  await pagina.click('summary:text("Ver datos de la gráfica")');
  assert.ok((await pagina.textContent('.grafica__tabla')).includes('Mantenimiento'));
  paso('operativo: KPIs, ICO por área, tabla ordenada, nombres escapados y tabla accesible');

  await pagina.fill('input[name=fecha]', dia(-20));
  await pagina.waitForSelector('text=No hay indicadores calculados para este día.');
  paso('operativo: día sin datos muestra aviso (sin romper)');

  // ------------------------------------------------------------------ clínico
  await pagina.click('#app-menu a[href="#/dashboard/clinico"]');
  await pagina.waitForSelector('select[name=operador] option:text("Ana Pérez")', { state: 'attached' });
  await pagina.selectOption('select[name=operador]', OP1);
  await pagina.waitForSelector('h2:text("Ana Pérez")');
  const lineas = await pagina.locator('svg[aria-label^="Gráfica de líneas"] path.grafica__linea').count();
  assert.equal(lineas, 2, 'la línea diaria se corta en el día sin dato; la media móvil de 7 días no se inventa con huecos');
  assert.ok((await pagina.textContent('svg[aria-label^="Radar"]')).includes('Inhibición (sin dato)'));
  assert.ok((await pagina.textContent('.recomendaciones')).includes('Pausa activa <i>de 10 minutos</i>.'));
  assert.equal(await pagina.locator('.recomendaciones i').count(), 0);
  paso('clínico: línea con hueco sin interpolar, radar con eje sin dato y recomendaciones como texto');

  // ---------------------------------------------------------------- ejecutivo
  await pagina.click('#app-menu a[href="#/dashboard/ejecutivo"]');
  await pagina.waitForSelector('h1:text("Dashboard ejecutivo")');
  await pagina.waitForSelector('.kpi__etiqueta:text("ICO de la empresa")');
  assert.deepEqual(await pagina.$$eval('.kpi__valor', (n) => n.map((x) => x.textContent)), ['62.3', '10', '0.7', '1']);
  assert.equal(await pagina.locator('svg[role=img]').count(), 3);
  paso('ejecutivo: KPIs de empresa, tendencia y comparación por área y cargo');

  // ---------------------------------------------------------------- científico
  await pagina.click('#app-menu a[href="#/dashboard/cientifico"]');
  await pagina.waitForSelector('.form-error:text("no está habilitado")');
  assert.equal(await db('(d) => d.auditoria.length'), 0);
  paso('científico: bloqueado sin la bandera de empresa');

  await pagina.evaluate(() => { window.__fakeDb.configuracion_empresa[0].feature_flags = { dashboard_cientifico: true }; });
  await pagina.goto(`${base}/#/dashboard/ejecutivo`);
  await pagina.click('#app-menu a[href="#/dashboard/cientifico"]');
  await pagina.waitForSelector('svg[aria-label^="Histograma"]');
  assert.ok(!(await pagina.textContent('.dashboard')).includes('Ana'), 'sin nombres reales en el dashboard científico');
  assert.ok(!/Beto|Carla/.test(await pagina.textContent('.dashboard')));
  assert.ok((await pagina.locator('.dashboard table').count()) >= 1);
  paso('científico: histograma con gaussiana, percentiles y sin identidades');

  assert.deepEqual(errores, [], `Errores de consola/página: ${errores.join(' | ')}`);
  paso('sin errores de consola');
  console.log('E2E DASHBOARD: OK');
} catch (error) {
  console.error('DOM:', (await pagina.textContent('#app-view').catch(() => '')).slice(0, 500));
  console.error('E2E FALLÓ:', error.message, '\nErrores de consola:', errores);
  process.exitCode = 1;
} finally {
  await navegador.close();
  servidor.close();
}
