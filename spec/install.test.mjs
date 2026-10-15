import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validarUrlSupabase, validarClaveAnonima, generarEnvJs, aplicarConnectSrc, concatenarMigraciones, generarBootstrap, sqlTexto, parsearArgumentos } from '../scripts/instalar.mjs';
import { resolverRuta } from '../scripts/servir.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const jwt = (rol) => `h.${Buffer.from(JSON.stringify({ role: rol })).toString('base64url')}.s`;

test('URL de Supabase: solo https y solo origen', () => {
  assert.equal(validarUrlSupabase(' https://abcd.supabase.co/ '), 'https://abcd.supabase.co');
  for (const mala of ['http://abcd.supabase.co', 'abcd.supabase.co', 'https://abcd.supabase.co/rest/v1', 'javascript:alert(1)']) assert.throws(() => validarUrlSupabase(mala), mala);
});

test('clave anónima: rechaza service_role y claves secretas', () => {
  assert.equal(validarClaveAnonima(jwt('anon')), jwt('anon'));
  assert.equal(validarClaveAnonima('sb_publishable_AbC-123_x'), 'sb_publishable_AbC-123_x');
  assert.throws(() => validarClaveAnonima(jwt('service_role')), /service_role/);
  assert.throws(() => validarClaveAnonima('sb_secret_abc'), /SECRETA/);
  assert.throws(() => validarClaveAnonima('basura'));
  assert.throws(() => validarClaveAnonima('a.b.c'));
});

test('env.js generado es JS válido y escapa valores', () => {
  const js = generarEnvJs({ url: 'https://a.supabase.co', anonKey: 'k"; alert(1); "' });
  const ventana = {};
  new Function('window', js)(ventana);
  assert.equal(ventana.__NEUROLAB_ENV__.SUPABASE_ANON_KEY, 'k"; alert(1); "');
  assert.equal(ventana.__NEUROLAB_ENV__.APP_ENV, 'production');
});

test('CSP: connect-src queda limitado al proyecto y el resto de la política no cambia', async () => {
  const html = await readFile(join(RAIZ, 'index.html'), 'utf8');
  const nuevo = aplicarConnectSrc(html, 'https://abcd.supabase.co');
  assert.match(nuevo, /connect-src 'self' https:\/\/abcd\.supabase\.co wss:\/\/abcd\.supabase\.co;/);
  assert.ok(!nuevo.includes('*.supabase.co'));
  assert.equal(nuevo.replace(/connect-src [^;"]*/, ''), html.replace(/connect-src [^;"]*/, ''));
  assert.match(html, /script-src 'self';/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
  assert.throws(() => aplicarConnectSrc('sin csp', 'https://a.supabase.co'));
});

test('instalación: migraciones en orden y contiguas', async () => {
  const { archivos, sql } = await concatenarMigraciones();
  assert.deepEqual(archivos, [...archivos].sort());
  archivos.forEach((f, i) => assert.equal(f.slice(0, 4), String(i + 1).padStart(4, '0'), `hueco antes de ${f}`));
  assert.ok(archivos.length >= 18);
  assert.ok(sql.includes('>>> 0018_research.sql'));
});

test('bootstrap: sustituye marcadores y bloquea inyección SQL', async () => {
  const plantilla = await readFile(join(RAIZ, 'supabase', 'bootstrap.sql'), 'utf8');
  const sql = generarBootstrap(plantilla, { empresa: "O'Brien & Cía", nit: '900123456-7', email: 'Admin@Correo.co', sembrar: true });
  assert.ok(sql.includes("'O''Brien & Cía'") && sql.includes("'900123456-7'") && sql.includes("lower('Admin@Correo.co')") && sql.includes("c_sembrar constant text := 'si'"));
  assert.ok(!/__[A-Z_]+__';/.test(sql.replace(/like '\\_\\_%'/g, '')), 'no quedan marcadores sin reemplazar');
  assert.throws(() => generarBootstrap(plantilla, { empresa: 'x', nit: '1', email: "a'; drop table x;--@b.co" }));
  assert.throws(() => generarBootstrap(plantilla, { empresa: 'x\ny', nit: '1', email: 'a@b.co' }));
  assert.throws(() => sqlTexto('', { nombre: 'el NIT' }), /Falta el NIT/);
  assert.equal(generarBootstrap(plantilla, { empresa: 'E', nit: '1', email: 'a@b.co' }).includes("c_sembrar constant text := 'no'"), true);
});

test('argumentos de línea de comandos', () => {
  assert.deepEqual(parsearArgumentos(['--url', 'https://a.supabase.co', '--nit=900-1', '--sembrar-provisional']), { url: 'https://a.supabase.co', nit: '900-1', 'sembrar-provisional': true });
  assert.throws(() => parsearArgumentos(['--url']));
  assert.throws(() => parsearArgumentos(['suelto']));
});

test('servidor local: no expone repositorio, scripts, pruebas ni SQL ni sale de la raíz', () => {
  assert.ok(resolverRuta('/').endsWith('index.html'));
  assert.ok(resolverRuta('/js/app.js'));
  for (const p of ['/.git/config', '/spec/dashboard.test.mjs', '/scripts/instalar.mjs', '/supabase/bootstrap.sql', '/node_modules/x', '/../etc/passwd', '/%2e%2e/etc/passwd']) assert.equal(resolverRuta(p), null, p);
});

test('service worker: todo recurso precacheado existe y el vendor está incluido', async () => {
  const sw = await readFile(join(RAIZ, 'service-worker.js'), 'utf8');
  const rutas = [...sw.matchAll(/'(\/[^']+\.(?:js|mjs|css|json|html|png))'/g)].map((m) => m[1]);
  assert.ok(rutas.includes('/vendor/supabase-js.mjs'));
  for (const r of rutas) await access(join(RAIZ, r)).catch(() => assert.fail(`El service worker precachea un archivo inexistente: ${r}`));
  const modulos = (await readFile(join(RAIZ, 'js', 'app.js'), 'utf8')).match(/from '\.\/[^']+'/g) ?? [];
  for (const m of modulos) assert.ok(rutas.includes(`/js/${m.slice(8, -1)}`), `app.js importa ${m} pero no está en el precaché`);
});
