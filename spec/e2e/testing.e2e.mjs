/**
 * @file spec/e2e/testing.e2e.mjs
 * @description Prueba de navegador (Chromium real) del Módulo 5 — Testing Engine,
 * con Supabase simulado: menú por permiso, operador propio y modo quiosco,
 * las 4 pruebas de punta a punta, resultado con ICO, fallo de guardado y reintento
 * idempotente.
 *
 * Ejecutar:  node spec/e2e/testing.e2e.mjs
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
const paso = (n) => console.log(`  ✓ ${n}`);
const errores = [];
const paginas = [];

/** Semilla ejecutada dentro del navegador antes de la app. */
function semilla(db) {
  const A = 'c1000000-0000-4000-8000-00000000000a';
  const tiempo = { tiempo_mejor_ms: 30000, tiempo_peor_ms: 180000, errores_maximo: 10, peso_tiempo: 0.5 };
  const v = (id, funcion, parametros) => ({ id, numero_version: 1, funcion_puntuacion: funcion, parametros, estado: 'experimental' });
  db.pruebas.push(
    { id: 'p1', codigo: 'atencion_cancelacion', nombre: 'Atención', categoria: 'atencion', estado: 'activa', version_actual: v('v1', 'compuesta_tiempo_errores', { celdas: 42, minimo_objetivos: 8, ...tiempo }) },
    { id: 'p2', codigo: 'stroop_adaptado', nombre: 'Stroop', categoria: 'inhibicion', estado: 'activa', version_actual: v('v2', 'compuesta_tiempo_errores', { items: 3, retardo_feedback_ms: 40, ...tiempo }) },
    { id: 'p3', codigo: 'memoria_secuencias', nombre: 'Memoria', categoria: 'memoria', estado: 'activa', version_actual: v('v3', 'lineal_mayor_mejor', { rondas: 2, minimo: 0, maximo: 2 }) },
    { id: 'p4', codigo: 'reaccion_simple', nombre: 'Reacción', categoria: 'velocidad', estado: 'activa', version_actual: v('v4', 'compuesta_tiempo_errores', { ensayos: 2, espera_min_ms: 100, espera_max_ms: 200, tiempo_mejor_ms: 200, tiempo_peor_ms: 500, errores_maximo: 5, peso_tiempo: 0.7 }) },
  );
  db.configuracion_empresa[0].baremo_modalidad = 'institucional';
  db.configuracion_empresa[0].pruebas_activas = [];
  db.ico_configuraciones.push({ id: 'cfg1', empresa_id: A, cargo_id: null, pesos: { atencion_cancelacion: 0.25, stroop_adaptado: 0.25, memoria_secuencias: 0.25, reaccion_simple: 0.25 }, vigente_desde: '2020-01-01T00:00:00Z', vigente_hasta: null });
  db.baremos.push({ id: 'bar1', empresa_id: A, prueba_id: null, modalidad: 'institucional', parametros: { umbrales: { excelente: 75, atencion: 50 } }, fuente: null, vigente_desde: '2020-01-01T00:00:00Z', vigente_hasta: null });
  db.reglas.push({ id: 'r1', empresa_id: null, nombre: 'ICO siempre', condicion: { indicador: 'ico', op: '<', valor: 101 }, severidad: 'roja', mensaje_plantilla: 'ICO de {operador} en {ico} (umbral {umbral}).', estado: 'activa' });
  db.recomendaciones_plantillas.push({ id: 'pl1', empresa_id: null, codigo: 'pausa', titulo: 'Pausa', texto: 'Pausa para {operador}', condicion_activacion: { indicador: 'indice_fatiga', op: '>=', valor: 0 } });
  db.operadores.push({ id: 'b1000000-0000-4000-8000-000000000001', empresa_id: A, usuario_id: window.__E2E_VINCULAR__ ? 'a1000000-0000-4000-8000-000000000001' : null, cedula: '1090123456', nombre: 'Luis', apellido: 'Rojas', estado: 'activo', cargo_id: null });
}

async function nuevaPagina({ vincular }) {
  const pagina = await navegador.newPage();
  paginas.push(pagina);
  pagina.on('pageerror', (e) => errores.push(String(e)));
  pagina.on('console', (m) => m.type() === 'error' && !/favicon|manifest|ERR_TUNNEL_CONNECTION_FAILED|sim red/.test(m.text()) && errores.push(m.text()));
  await pagina.addInitScript(`window.__E2E_PERMISOS__ = ['evaluaciones.registrar']; window.__E2E_VINCULAR__ = ${vincular}; window.__E2E_SEED__ = ${semilla.toString()};`);
  await pagina.route('**/js/env.js', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: "window.__NEUROLAB_ENV__={SUPABASE_URL:'https://e2e.supabase.co',SUPABASE_ANON_KEY:'e2e',APP_ENV:'development',LOG_LEVEL:'error'};" }),
  );
  await pagina.route('**/vendor/supabase-js.mjs', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE_SOURCE }));
  await pagina.goto(`${base}/#/`);
  await pagina.waitForSelector('#login-form');
  await pagina.fill('input[name=email]', 'a@x.co');
  await pagina.fill('input[name=password]', 'secreto');
  await pagina.click('[data-submit]');
  await pagina.waitForSelector('#app-menu a');
  return pagina;
}

/** Recorre las 4 pruebas con el mínimo de interacción. */
async function jugarLasCuatro(pagina) {
  const tutorial = async () => {
    await pagina.waitForSelector('button:text("Entendido")');
    await pagina.click('button:text("Entendido")');
  };
  // 1. Atención
  await tutorial();
  await pagina.waitForSelector('.sym-btn');
  await pagina.locator('.sym-btn').first().click();
  await pagina.click('button:text("Finalizar")');
  // 2. Stroop (3 ítems)
  await tutorial();
  for (let i = 1; i <= 3; i += 1) {
    await pagina.waitForFunction((n) => document.querySelector('.test-progress')?.textContent === `${n}/3` && !document.querySelector('.stroop-btn')?.disabled, i);
    await pagina.locator('.stroop-btn').first().click();
  }
  // 3. Memoria (2 rondas)
  await tutorial();
  for (let r = 0; r < 2; r += 1) {
    await pagina.waitForFunction(() => document.querySelector('.test-panel .test-feedback')?.textContent === 'Repita la secuencia');
    for (let k = 0; k < r + 1; k += 1) await pagina.locator('.mem-cell').first().click();
    if (r === 0) await pagina.waitForFunction(() => document.querySelector('.test-panel .test-feedback')?.textContent === 'Observe la secuencia');
  }
  // 4. Reacción (2 ensayos)
  await tutorial();
  for (let i = 0; i < 2; i += 1) {
    await pagina.waitForSelector('.reaction-area[data-estado="ya"]');
    await pagina.click('.reaction-area');
    await pagina.waitForFunction(() => document.querySelector('.reaction-area')?.dataset.estado !== 'ya');
  }
}

try {
  // ------------------------------------------------ Escenario A: operador propio
  const A = await nuevaPagina({ vincular: true });
  assert.deepEqual(await A.$$eval('#app-menu a', (as) => as.map((a) => a.textContent)), ['Inicio', 'Evaluación']);
  paso('menú muestra Evaluación solo con evaluaciones.registrar');
  await A.click('#app-menu a[href="#/evaluacion"]');
  await A.waitForSelector('button:text("Comenzar evaluación")');
  assert.match(await A.textContent('.eval-operador'), /Luis Rojas \(1090123456\)/);
  assert.equal(await A.locator('input[name=cedula]').count(), 0);
  assert.deepEqual(await A.$$eval('select[name=turno] option', (o) => o.map((x) => x.textContent)), ['Diurno', 'Nocturno']);
  paso('operador propio preseleccionado y turnos por defecto');

  await A.click('button:text("Comenzar evaluación")');
  await jugarLasCuatro(A);
  await A.waitForSelector('text=Resultado de la evaluación');
  await A.waitForSelector('text=Evaluación guardada correctamente.');
  assert.equal(await A.locator('.eval-tabla tbody tr').count(), 4);
  const guardadas = await A.evaluate(() => window.__fakeDb.evaluaciones);
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].resultados.length, 4);
  assert.equal(typeof guardadas[0].ico_valor, 'number');
  assert.ok(['excelente', 'aceptable', 'requiere_atencion'].includes(guardadas[0].ico_nivel));
  assert.equal(guardadas[0].ico_configuracion_id, 'cfg1');
  assert.equal(guardadas[0].baremo_snapshot_id, 'bar1');
  assert.ok(guardadas[0].resultados.every((r) => r.puntaje_normalizado >= 0 && r.puntaje_normalizado <= 100));
  paso('4 pruebas completas, ICO clasificado y evaluación guardada con trazabilidad');

  // Indicadores derivados: se recalculan tras guardar (ventana diaria y de 30 días).
  await A.waitForFunction(() => window.__fakeDb.indicadores_valores.some((x) => x.indicador_id === 'def-ico_empresa'));
  const ind = await A.evaluate(() => window.__fakeDb.indicadores_valores.map((x) => ({ i: x.indicador_id.replace('def-', ''), p: x.periodo, v: x.valor })));
  const ventanasPublicadas = new Set(ind.map((x) => x.p));
  assert.equal(ventanasPublicadas.size, 2);
  const icoTrab = ind.filter((x) => x.i === 'ico_trabajador');
  assert.equal(icoTrab.length, 2);
  assert.ok(icoTrab.every((x) => x.v === guardadas[0].ico_valor));
  assert.ok(ind.some((x) => x.i === 'ico_empresa') && ind.some((x) => x.i === 'indice_fatiga'));
  paso('indicadores por operador y por empresa recalculados tras la evaluación');

  // Reglas: alerta con mensaje resuelto y recomendación, una sola vez.
  await A.waitForFunction(() => window.__fakeDb.alertas.length > 0 && window.__fakeDb.recomendaciones_generadas.length > 0);
  const alertas = await A.evaluate(() => window.__fakeDb.alertas);
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].mensaje, `ICO de Luis Rojas en ${Math.round(guardadas[0].ico_valor * 10) / 10} (umbral 101).`);
  assert.equal(alertas[0].operador_id, guardadas[0].operador_id);
  assert.equal(await A.evaluate(() => window.__fakeDb.recomendaciones_generadas[0].texto), 'Pausa para Luis Rojas');
  paso('reglas: alerta y recomendación generadas con el nombre del operador');

  await A.click('button:text("Nueva evaluación")');
  await A.waitForSelector('button:text("Comenzar evaluación")');
  paso('nueva evaluación disponible');

  // Tutorial ya visto: la segunda evaluación no lo repite.
  await A.click('button:text("Comenzar evaluación")');
  await A.waitForSelector('.sym-btn');
  assert.equal(await A.locator('button:text("Entendido")').count(), 0);
  paso('el tutorial se muestra solo la primera vez');
  await A.close();

  // ------------------------------------------------ Escenario B: quiosco + fallo de guardado
  const B = await nuevaPagina({ vincular: false });
  await B.click('#app-menu a[href="#/evaluacion"]');
  await B.waitForSelector('input[name=cedula]');
  assert.equal(await B.isDisabled('button:text("Comenzar evaluación")'), true);
  await B.fill('input[name=cedula]', '999');
  await B.click('button:text("Buscar")');
  await B.waitForSelector('[role=alert]:text("No se encontró")');
  assert.equal(await B.isDisabled('button:text("Comenzar evaluación")'), true);
  await B.fill('input[name=cedula]', '1090123456');
  await B.press('input[name=cedula]', 'Enter');
  await B.waitForFunction(() => !document.querySelector('.test-panel button.button-primary')?.disabled);
  await B.selectOption('select[name=turno]', 'Nocturno');
  paso('modo quiosco: cédula inexistente rechazada, existente habilita');

  await B.evaluate(() => { window.__E2E_RPC_FALLA__ = 1; });
  await B.click('button:text("Comenzar evaluación")');
  await jugarLasCuatro(B);
  await B.waitForSelector('text=Sin conexión: la evaluación quedó pendiente de envío.');
  assert.equal(await B.evaluate(() => window.__fakeDb.evaluaciones.length), 0);
  await B.waitForSelector('#offline-banner:not([hidden])');
  assert.ok((await B.textContent('#offline-banner')).includes('1 evaluación(es) pendiente(s)'));
  const enCola = await B.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('neurolab-offline', 1);
    r.onsuccess = () => { const q = r.result.transaction('cola').objectStore('cola').getAll(); q.onsuccess = () => ok(q.result.length); };
  }));
  assert.equal(enCola, 1, 'la evaluación quedó persistida en IndexedDB');
  paso('fallo de red → la evaluación queda en la cola de IndexedDB y se avisa');

  await B.reload(); // la sesión simulada vive en memoria: se vuelve a entrar; la cola está en IndexedDB
  await B.waitForSelector('#login-form');
  await B.fill('input[name=email]', 'a@x.co');
  await B.fill('input[name=password]', 'secreto');
  await B.click('[data-submit]');
  paso('la cola sobrevive a una recarga de la página');

  // Al iniciar sesión (con red de nuevo) la cola se sincroniza sola.
  await B.waitForFunction(() => window.__fakeDb.evaluaciones.length === 1);
  await B.waitForSelector('#offline-banner', { state: 'hidden' });
  const [unica] = await B.evaluate(() => window.__fakeDb.evaluaciones);
  assert.equal(unica.turno, 'Nocturno');
  await B.waitForFunction(() => window.__fakeDb.indicadores_valores.length > 0);
  paso('al volver la conexión se sincroniza sola, se guarda UNA vez y corre el recálculo de indicadores');

  await B.evaluate(() => window.__fakeDb.evaluaciones.length);
  assert.deepEqual(errores, [], `Errores de consola/página: ${errores.join(' | ')}`);
  paso('sin errores de consola');
  console.log('E2E TESTING: OK');
} catch (error) {
  const ultima = paginas.at(-1);
  if (ultima) console.error('DOM:', (await ultima.textContent('#app-view').catch(() => '')).slice(0, 400));
  console.error('E2E FALLÓ:', error.message, '\nErrores de consola:', errores);
  process.exitCode = 1;
} finally {
  await navegador.close();
  servidor.close();
}
