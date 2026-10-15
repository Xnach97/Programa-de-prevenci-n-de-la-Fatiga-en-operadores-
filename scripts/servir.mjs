#!/usr/bin/env node
/**
 * scripts/servir.mjs — Servidor estático local para NeuroLab SST (sin dependencias).
 * Uso:  node scripts/servir.mjs [puerto]      (por defecto 8000, solo en 127.0.0.1)
 * Para producción use un hosting estático con HTTPS (Netlify, Cloudflare Pages, Vercel…):
 * suba esta carpeta tal cual; `_headers` aporta las cabeceras de seguridad.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const puerto = Number(process.argv[2] ?? 8000);

export function resolverRuta(urlPath) {
  const limpia = decodeURIComponent(urlPath.split('?')[0]);
  const archivo = normalize(join(RAIZ, limpia === '/' ? 'index.html' : limpia));
  if (archivo !== RAIZ && !archivo.startsWith(RAIZ.endsWith(sep) ? RAIZ : RAIZ + sep)) return null;
  const relativa = archivo.slice(RAIZ.length);
  // Nunca servir repositorio, scripts, pruebas ni SQL.
  if (/^(\.git|node_modules|spec|scripts|supabase)(\/|$)/.test(relativa.replaceAll('\\', '/'))) return null;
  return archivo;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  http.createServer(async (req, res) => {
    try {
      const archivo = resolverRuta(new URL(req.url, 'http://x').pathname);
      if (!archivo) throw new Error('prohibido');
      const cuerpo = await readFile(archivo);
      res.writeHead(200, { 'content-type': MIME[extname(archivo)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
      res.end(cuerpo);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
    }
  }).listen(puerto, '127.0.0.1', () => console.log(`NeuroLab SST en http://localhost:${puerto}  (Ctrl+C para detener)`));
}
