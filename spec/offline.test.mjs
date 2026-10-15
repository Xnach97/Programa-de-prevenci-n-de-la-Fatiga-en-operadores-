import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineQueue, crearGuardadoConCola, clasificarError, crearAlmacenMemoria, ESTADOS_COLA } from '../services/offline-queue.js';
import { conCacheLectura } from '../services/read-cache.js';

const ID = (n) => `e000000${n}-0000-4000-8000-00000000000${n}`;
const payload = (n) => ({ evaluacion_id: ID(n), empresa_id: 'c1000000-0000-4000-8000-00000000000a', operador_id: 'b', resultados: [] });
const errRed = () => new TypeError('Failed to fetch');
const errPg = (code) => Object.assign(new Error('x'), { causaOriginal: { code } });

function crear({ enviar, hook = null, t = { v: 1_000_000 } } = {}) {
  const almacen = crearAlmacenMemoria();
  const cola = new OfflineQueue({ almacen, enviar, alSincronizado: hook, ahora: () => t.v, azar: () => 0.5, retardoBaseMs: 1000, retardoMaxMs: 8000 });
  return { cola, almacen, t };
}

test('clasifica errores: red/5xx/JWT transitorios; BD de validación/permiso permanentes', () => {
  assert.equal(clasificarError(errRed()), 'transitorio');
  assert.equal(clasificarError(errPg('PGRST301')), 'transitorio');
  assert.equal(clasificarError(errPg('08006')), 'transitorio');
  assert.equal(clasificarError(Object.assign(new Error('x'), { causaOriginal: { status: 503 } })), 'transitorio');
  assert.equal(clasificarError(errPg('42501')), 'permanente');
  assert.equal(clasificarError(errPg('23514')), 'permanente');
  assert.equal(clasificarError(errPg('P0001')), 'permanente');
});

test('encolar es idempotente por evaluacion_id y exige UUID', async () => {
  const { cola } = crear({ enviar: async () => ({}) });
  assert.equal((await cola.encolar(payload(1))).yaExistia, false);
  assert.equal((await cola.encolar(payload(1))).yaExistia, true);
  assert.equal((await cola.estado()).pendientes, 1);
  await assert.rejects(() => cola.encolar({ evaluacion_id: 'no' }), TypeError);
});

test('sincronizar envía en orden, borra y ejecuta el post-registro con el contexto', async () => {
  const enviados = [];
  const hooks = [];
  const { cola, t } = crear({ enviar: async (p) => { enviados.push(p.evaluacion_id); return { duplicada: false }; }, hook: async (item) => { hooks.push(item.contexto.x); } });
  await cola.encolar(payload(1), { x: 'a' });
  t.v += 10;
  await cola.encolar(payload(2), { x: 'b' });
  const r = await cola.sincronizar();
  assert.deepEqual(enviados, [ID(1), ID(2)]);
  assert.deepEqual(hooks, ['a', 'b']);
  assert.deepEqual(r, { enviadas: 2, pendientes: 0, rechazadas: 0 });
});

test('fallo transitorio: retroceso exponencial, corta el ciclo y recupera al volver la red', async () => {
  let hayRed = false;
  let llamadas = 0;
  const { cola, t } = crear({ enviar: async () => { llamadas += 1; if (!hayRed) throw errRed(); return {}; } });
  await cola.encolar(payload(1));
  await cola.encolar(payload(2));
  let r = await cola.sincronizar();
  assert.equal(llamadas, 1, 'no insiste con el resto sin red');
  assert.equal(r.pendientes, 2);
  r = await cola.sincronizar(); // aún dentro del retroceso: no intenta
  assert.equal(llamadas, 1);
  assert.equal(cola.retardo(1), 1000);
  assert.equal(cola.retardo(2), 2000);
  assert.equal(cola.retardo(10), 8000);
  hayRed = true;
  t.v += 1500;
  r = await cola.sincronizar();
  assert.equal(r.enviadas, 2);
  assert.equal(r.pendientes, 0);
});

test('error permanente: se rechaza sin bucle, se conserva y puede reintentarse o descartarse', async () => {
  let n = 0;
  const { cola } = crear({ enviar: async () => { n += 1; throw errPg('42501'); } });
  await cola.encolar(payload(1));
  const r = await cola.sincronizar();
  assert.deepEqual(r, { enviadas: 0, pendientes: 0, rechazadas: 1 });
  await cola.sincronizar({ forzar: true });
  assert.equal(n, 1, 'una rechazada no se reenvía');
  await cola.reintentarRechazadas();
  assert.equal((await cola.estado()).pendientes, 1);
  await cola.sincronizar({ forzar: true });
  await cola.descartarRechazadas();
  assert.equal((await cola.estado()).rechazadas, 0);
});

test('un solo sincronizador a la vez', async () => {
  let activos = 0;
  let maximo = 0;
  const { cola } = crear({ enviar: async () => { activos += 1; maximo = Math.max(maximo, activos); await new Promise((r) => setTimeout(r, 10)); activos -= 1; return {}; } });
  await cola.encolar(payload(1));
  await Promise.all([cola.sincronizar(), cola.sincronizar(), cola.sincronizar()]);
  assert.equal(maximo, 1);
});

test('el fallo del post-registro no devuelve el elemento a la cola', async () => {
  const { cola } = crear({ enviar: async () => ({}), hook: async () => { throw new Error('indicadores'); } });
  await cola.encolar(payload(1));
  const r = await cola.sincronizar();
  assert.equal(r.enviadas, 1);
  assert.equal((await cola.estado()).pendientes, 0);
});

test('aviso de antigüedad: vencida cuando el más antiguo supera el umbral', async () => {
  const { cola, t } = crear({ enviar: async () => { throw errRed(); } });
  await cola.encolar(payload(1));
  assert.equal((await cola.estado()).vencida, false);
  t.v += cola.umbralAlertaMs + 1;
  const e = await cola.estado();
  assert.equal(e.vencida, true);
  assert.ok(e.masAntiguaMs >= cola.umbralAlertaMs);
});

test('guardado con cola: en línea envía; sin red o fallo transitorio encola; permanente propaga', async () => {
  const { cola } = crear({ enviar: async () => ({}) });
  const directo = crearGuardadoConCola({ cola, enviar: async (p) => ({ evaluacion_id: p.evaluacion_id, duplicada: false }) });
  assert.equal((await directo(payload(1))).encolada, undefined);
  const sinRed = crearGuardadoConCola({ cola, enviar: async () => { throw errRed(); } });
  const r = await sinRed(payload(2), { operadorNombre: 'A' });
  assert.equal(r.encolada, true);
  const offline = crearGuardadoConCola({ cola, enviar: async () => assert.fail('no debe enviar'), estaEnLinea: () => false });
  assert.equal((await offline(payload(3))).encolada, true);
  const permanente = crearGuardadoConCola({ cola, enviar: async () => { throw errPg('23514'); } });
  await assert.rejects(() => permanente(payload(4)));
  assert.equal((await cola.estado()).pendientes, 2);
});

test('caché de lectura: red primero, respaldo ante fallo transitorio, nunca ante permanente ni vencido', async () => {
  const t = { v: 0 };
  let falla = null;
  const repo = { async listar(id) { if (falla) throw falla; return [`datos-${id}`]; }, otro() { return 'tal cual'; } };
  const almacen = crearAlmacenMemoria('clave');
  const c = conCacheLectura(repo, { listar: ([id]) => `emp:${id}` }, { almacen, ahora: () => t.v, ttlMs: 1000 });
  assert.deepEqual(await c.listar('A'), ['datos-A']);
  falla = errRed();
  assert.deepEqual(await c.listar('A'), ['datos-A']);
  await assert.rejects(() => c.listar('B'), TypeError);
  t.v = 5000;
  await assert.rejects(() => c.listar('A'), TypeError);
  t.v = 0;
  falla = errPg('42501');
  await assert.rejects(() => c.listar('A'));
  assert.equal(c.otro(), 'tal cual');
});

test('estados exportados', () => assert.deepEqual(Object.values(ESTADOS_COLA).sort(), ['pendiente', 'rechazada']));
