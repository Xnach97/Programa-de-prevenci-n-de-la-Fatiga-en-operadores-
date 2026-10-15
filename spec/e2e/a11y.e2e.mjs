/**
 * @file spec/e2e/a11y.e2e.mjs
 * @description Prueba de navegador del Módulo 11: auditoría de accesibilidad automática (axe-core, WCAG 2.1 A/AA) de todas las pantallas
 * 
 * con Supabase simulado. Requiere `axe-core` (npm i axe-core) accesible desde node_modules.
 *
 * Ejecutar:  node spec/e2e/a11y.e2e.mjs
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

import { createRequire } from 'node:module';
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

function semilla(db) {
  const A = 'c1000000-0000-4000-8000-00000000000a';
  const AREA = 'd1000000-0000-4000-8000-000000000001';
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const man = new Date(Date.parse(hoy + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  db.areas.push({ id: AREA, empresa_id: A, nombre: 'Mantenimiento', estado: 'activo' });
  db.pruebas.push({ id: 'p1', codigo: 'reaccion_simple', nombre: 'Reacción', categoria: 'velocidad', estado: 'activa', version_actual: { id: 'v1', numero_version: 1, funcion_puntuacion: 'x', parametros: {}, estado: 'experimental' } });
  db.reglas.push({ id: 'g1', empresa_id: null, nombre: 'ICO crítico', condicion: { indicador: 'ico', op: '<', valor: 50 }, severidad: 'roja', mensaje_plantilla: 'x', estado: 'activa' });
  const ops = [];
  for (let i = 1; i <= 3; i += 1) {
    const id = `b100000${i}-0000-4000-8000-00000000000${i}`;
    ops.push(id);
    db.operadores.push({ id, empresa_id: A, cedula: `90${i}`, nombre: `Op${i}`, apellido: `Ape${i}`, estado: 'activo', area_id: AREA, cargo_id: null });
    db.indicadores_valores.push({ indicador_id: 'def-ico_trabajador', empresa_id: A, ambito_id: id, periodo: '[' + hoy + ',' + man + ')', valor: 50 + i * 10, detalle: {}, calculado_en: new Date().toISOString() });
  }
  db.indicadores_valores.push({ indicador_id: 'def-ico_empresa', empresa_id: A, ambito_id: A, periodo: '[' + hoy + ',' + man + ')', valor: 70, detalle: {}, calculado_en: new Date().toISOString() });
  db.indicadores_valores.push({ indicador_id: 'def-ico_area', empresa_id: A, ambito_id: AREA, periodo: '[' + hoy + ',' + man + ')', valor: 70, detalle: {}, calculado_en: new Date().toISOString() });
  db.alertas.push({ id: 'a7000000-0000-4000-8000-000000000001', empresa_id: A, regla_id: 'g1', operador_id: ops[0], evaluacion_id: 'e1', severidad: 'roja', mensaje: 'ICO bajo', estado: 'abierta', created_at: new Date().toISOString() });
  db.auditoria.push({ id: 'au1', empresa_id: A, usuario_id: 'u1', accion: 'x.update', entidad: 'x', detalle_anterior: {}, detalle_nuevo: {}, created_at: new Date().toISOString() });
  db.configuracion_empresa[0].feature_flags = { dashboard_cientifico: true };
}

await pagina.addInitScript(
  `window.__E2E_PERMISOS__ = ['evaluaciones.ver','evaluaciones.registrar','operadores.ver','operadores.administrar','catalogos.ver','catalogos.editar','configuracion.editar','alertas.gestionar','auditoria.ver','investigacion.acceder','datos.exportar']; window.__E2E_SEED__ = ${semilla.toString()};`,
);
await pagina.route('**/js/env.js', (r) =>
  r.fulfill({ contentType: 'text/javascript', body: "window.__NEUROLAB_ENV__={SUPABASE_URL:'https://e2e.supabase.co',SUPABASE_ANON_KEY:'e2e',APP_ENV:'development',LOG_LEVEL:'error'};" }),
);
await pagina.route('**/vendor/supabase-js.mjs', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE_SOURCE }));
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


const RUTAS = ['/', '/operadores', '/catalogos', '/evaluacion', '/alertas', '/dashboard/operativo', '/dashboard/clinico', '/dashboard/ejecutivo', '/dashboard/cientifico', '/admin/configuracion', '/admin/reglas', '/admin/auditoria', '/investigacion'];
const hallazgos = [];

async function auditar(nombre) {
  // (axe se inyecta con addInitScript, vía CDP: un <script> en línea lo bloquearía la CSP, como debe.)
  const r = await pagina.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  for (const v of r.violations) hallazgos.push({ pantalla: nombre, regla: v.id, impacto: v.impact, nodos: v.nodes.length, ejemplo: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 90)).join(' | '), resumen: [...new Set(v.nodes.map((n) => (n.failureSummary.match(/contrast of ([\d.]+) \(foreground color: (#\w+), background color: (#\w+)/) ?? []).slice(1).join(' '))).values()].join(' ; ').slice(0, 260) || v.nodes[0]?.failureSummary?.slice(0, 200) });
}

await pagina.addInitScript({ content: await readFile(AXE, 'utf8') });

try {
  await pagina.goto(`${base}/#/`);
  await pagina.waitForSelector('#login-form');
  await auditar('login');
  await pagina.fill('input[name=email]', 'a@x.co');
  await pagina.fill('input[name=password]', 'secreto');
  await pagina.click('[data-submit]');
  await pagina.waitForSelector('#app-menu a');
  for (const ruta of RUTAS) {
    await pagina.evaluate((r) => { location.hash = '#' + r; }, ruta);
    await pagina.waitForTimeout(700);
    await pagina.waitForSelector('#app-view h1, #app-view h2, #app-view .org-view', { timeout: 8000 }).catch(() => {});
    await auditar(ruta);
  }
  const resumen = new Map();
  for (const h of hallazgos) {
    const k = `${h.regla}`;
    const e = resumen.get(k) ?? { regla: h.regla, impacto: h.impacto, pantallas: new Set(), nodos: 0, ejemplo: h.ejemplo, resumen: h.resumen };
    e.pantallas.add(h.pantalla); e.nodos += h.nodos; resumen.set(k, e);
  }
  for (const e of resumen.values()) console.log(`  ✗ [${e.impacto}] ${e.regla} — ${e.nodos} nodo(s) en ${[...e.pantallas].join(', ')}\n      ${e.ejemplo}\n      ${e.resumen}`);
  const graves = hallazgos.filter((h) => h.impacto === 'critical' || h.impacto === 'serious');
  console.log(`A11Y: ${RUTAS.length + 1} pantallas auditadas, ${hallazgos.length} hallazgo(s), ${graves.length} grave(s)/crítico(s)`);
  assert.equal(graves.length, 0, 'hay violaciones graves de accesibilidad');
  console.log('E2E A11Y: OK');
} catch (error) {
  console.error('E2E FALLÓ:', error.message);
  process.exitCode = 1;
} finally {
  await navegador.close();
  servidor.close();
}
