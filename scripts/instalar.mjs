#!/usr/bin/env node
/**
 * scripts/instalar.mjs — Instalador de NeuroLab SST (Módulo 11)
 *
 * Qué hace (todo es idempotente: puede ejecutarse varias veces):
 *   1. Genera `js/env.js` con la URL y la clave ANÓNIMA de SU proyecto Supabase.
 *   2. Ajusta la política CSP (index.html y _headers) al origen de su proyecto.
 *   3. Genera `supabase/instalacion.sql` = todas las migraciones en orden (para pegar en
 *      Supabase → SQL Editor si prefiere no usar la línea de comandos).
 *   4. Con `--db-url`: aplica las migraciones con `psql` y, si se dan --empresa, --nit y
 *      --admin-email, crea la primera empresa y su administrador (supabase/bootstrap.sql).
 *
 * Uso interactivo:   node scripts/instalar.mjs
 * Uso con argumentos:
 *   node scripts/instalar.mjs --url https://xxxx.supabase.co --anon-key eyJ... \
 *        --db-url "postgresql://postgres:CLAVE@db.xxxx.supabase.co:5432/postgres" \
 *        --empresa "Mi Empresa S.A." --nit 900123456-7 --admin-email yo@correo.com [--sembrar-provisional]
 *
 * NUNCA se usa la clave `service_role`: la app solo necesita la clave anónima (la seguridad
 * la imponen las políticas RLS). La cadena de conexión (`--db-url`) solo se usa aquí, localmente.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

// ------------------------------------------------------------- funciones puras
export function validarUrlSupabase(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new Error('La URL de Supabase no es válida. Ejemplo: https://abcd1234.supabase.co'); }
  if (u.protocol !== 'https:') throw new Error('La URL de Supabase debe empezar por https://');
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('Use solo el origen del proyecto, sin rutas (https://abcd1234.supabase.co).');
  return u.origin;
}

export function validarClaveAnonima(clave) {
  const k = String(clave ?? '').trim();
  if (/^sb_secret_/.test(k)) throw new Error('Esa es una clave SECRETA. Use la clave anónima/pública (anon / publishable): la secreta jamás debe ir en el navegador.');
  const partes = k.split('.');
  if (partes.length === 3) {
    try {
      const rol = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')).role;
      if (rol === 'service_role') throw new Error('Esa es la clave service_role (secreta). Use la clave "anon" (pública).');
    } catch (e) {
      if (/service_role/.test(e.message)) throw e;
      throw new Error('La clave anónima no tiene el formato esperado (JWT).');
    }
    return k;
  }
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(k)) return k;
  throw new Error('La clave anónima no tiene un formato reconocido (JWT "anon" o "sb_publishable_…").');
}

const literal = (v) => JSON.stringify(String(v));

export function generarEnvJs({ url, anonKey, entorno = 'production', nivelLog = 'warn' }) {
  return `/* Generado por scripts/instalar.mjs — NO se versiona (ver .gitignore). */
window.__NEUROLAB_ENV__ = {
  SUPABASE_URL: ${literal(url)},
  SUPABASE_ANON_KEY: ${literal(anonKey)},
  APP_ENV: ${literal(entorno)},
  LOG_LEVEL: ${literal(nivelLog)},
};
`;
}

/** Sustituye la directiva connect-src por una que permita SOLO su proyecto (REST/Auth + Realtime). */
export function aplicarConnectSrc(texto, url) {
  const u = new URL(url);
  const nueva = `connect-src 'self' ${u.origin} wss://${u.host}`;
  if (!/connect-src [^;"\n]*/.test(texto)) throw new Error('No se encontró la directiva connect-src.');
  return texto.replace(/connect-src [^;"\n]*/g, nueva);
}

export async function concatenarMigraciones(dir = join(RAIZ, 'supabase', 'migrations')) {
  const archivos = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const partes = [];
  for (const f of archivos) partes.push(`-- >>> ${f}\n${(await readFile(join(dir, f), 'utf8')).trim()}\n`);
  return {
    archivos,
    sql: `-- NeuroLab SST — instalación completa (${archivos.length} migraciones, idempotente).\n-- Generado por scripts/instalar.mjs. Pegar completo en Supabase → SQL Editor → Run.\n\n${partes.join('\n')}`,
  };
}

/** Escapa un valor de texto para un literal SQL entre comillas simples. */
export function sqlTexto(valor, { max = 200, nombre = 'valor' } = {}) {
  const v = String(valor ?? '').trim();
  if (!v) throw new Error(`Falta ${nombre}.`);
  if (v.length > max) throw new Error(`${nombre} es demasiado largo.`);
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new Error(`${nombre} contiene caracteres no permitidos.`);
  return v.replace(/'/g, "''"); // con standard_conforming_strings (por defecto) solo la comilla simple es especial
}

export function generarBootstrap(plantilla, { empresa, nit, email, sembrar = false }) {
  const correo = String(email ?? '').trim();
  if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(correo)) throw new Error('El correo del administrador no es válido.');
  return plantilla
    .replaceAll('__EMPRESA__', () => sqlTexto(empresa, { nombre: 'el nombre de la empresa', max: 120 }))
    .replaceAll('__NIT__', () => sqlTexto(nit, { nombre: 'el NIT', max: 40 }))
    .replaceAll('__ADMIN_EMAIL__', () => correo)
    .replaceAll('__SEMBRAR_PROVISIONAL__', sembrar ? 'si' : 'no');
}

export function parsearArgumentos(argv) {
  const salida = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Argumento inesperado: ${a}`);
    const [clave, valor] = a.slice(2).split(/=(.*)/s);
    if (['sembrar-provisional', 'solo-archivos', 'ayuda'].includes(clave)) salida[clave] = true;
    else if (valor !== undefined) salida[clave] = valor;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { salida[clave] = argv[i + 1]; i += 1; }
    else throw new Error(`Falta el valor de --${clave}`);
  }
  return salida;
}

// -------------------------------------------------------------------- ejecución
function psql(dbUrl, args) {
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
  if (r.error) throw new Error('No se encontró "psql". Instale el cliente de PostgreSQL o pegue supabase/instalacion.sql en el SQL Editor de Supabase.');
  if (r.status !== 0) throw new Error('psql terminó con error (ver mensaje arriba). Revise la cadena de conexión y vuelva a intentar.');
}

async function preguntar(rl, texto, actual) {
  if (actual) return actual;
  return (await rl.question(`${texto}: `)).trim();
}

async function principal() {
  const args = parsearArgumentos(process.argv.slice(2));
  if (args.ayuda) {
    console.log('Uso: node scripts/instalar.mjs [--url ...] [--anon-key ...] [--db-url ...] [--empresa ...] [--nit ...] [--admin-email ...] [--sembrar-provisional] [--solo-archivos]');
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const url = validarUrlSupabase(await preguntar(rl, 'URL de su proyecto Supabase (https://xxxx.supabase.co)', args.url));
    const anonKey = validarClaveAnonima(await preguntar(rl, 'Clave anónima (anon / publishable) de Supabase → Settings → API', args['anon-key']));

    await writeFile(join(RAIZ, 'js', 'env.js'), generarEnvJs({ url, anonKey }));
    console.log('✓ js/env.js generado');

    for (const f of ['index.html', '_headers']) {
      const ruta = join(RAIZ, f);
      await writeFile(ruta, aplicarConnectSrc(await readFile(ruta, 'utf8'), url));
    }
    console.log('✓ CSP ajustada a su proyecto (index.html y _headers)');

    const { archivos, sql } = await concatenarMigraciones();
    await writeFile(join(RAIZ, 'supabase', 'instalacion.sql'), sql);
    console.log(`✓ supabase/instalacion.sql generado (${archivos.length} migraciones)`);

    if (args['solo-archivos']) return;
    const dbUrl = args['db-url'] ?? (args.url ? null : (await rl.question('Cadena de conexión a la base (Settings → Database → Connection string, URI) — ENTER para omitir: ')).trim());
    if (!dbUrl) {
      console.log('\nSiguiente paso (manual): en Supabase → SQL Editor pegue supabase/instalacion.sql y pulse Run.\nLuego cree su usuario en Authentication → Users y ejecute supabase/bootstrap.sql (reemplazando los marcadores).');
      return;
    }
    psql(dbUrl, ['-f', join(RAIZ, 'supabase', 'instalacion.sql')]);
    console.log('✓ Migraciones aplicadas');

    const empresa = args.empresa ?? (await rl.question('Nombre de la empresa (ENTER para omitir el alta de empresa): ')).trim();
    if (empresa) {
      const nit = await preguntar(rl, 'NIT', args.nit);
      const email = await preguntar(rl, 'Correo del administrador (ya creado en Authentication → Users)', args['admin-email']);
      const sql2 = generarBootstrap(await readFile(join(RAIZ, 'supabase', 'bootstrap.sql'), 'utf8'), { empresa, nit, email, sembrar: args['sembrar-provisional'] === true });
      const destino = join(RAIZ, 'supabase', 'bootstrap.generado.sql');
      await writeFile(destino, sql2);
      try { psql(dbUrl, ['-f', destino]); } finally { /* contiene el correo del administrador: no se versiona (.gitignore) */ }
      console.log('✓ Empresa y administrador creados');
    }
    console.log('\nListo. Inicie la aplicación con:  node scripts/servir.mjs   y abra http://localhost:8000');
  } finally {
    rl.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
}
