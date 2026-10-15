import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRng } from '../tests/_comun.js';
import { testRegistry, TestRegistry } from '../tests/test-registry.js';
import '../tests/index.js';
import { generarTablero, evaluarCancelacion, resumirAtencion } from '../tests/attention.js';
import { generarItems, resumirStroop } from '../tests/stroop.js';
import { generarSecuencias, crearSesionMemoria, resumirMemoria } from '../tests/memory.js';
import { generarEsperas, resumirReaccion, crudoReaccion } from '../tests/reaction.js';
import { EvaluacionService, EvaluacionError, turnosDeEmpresa } from '../services/evaluacion-service.js';
import { ScientificError, CODIGOS_CIENTIFICOS } from '../statistics/scientific-error.js';

const EMP = 'c1000000-0000-4000-8000-00000000000a';
const OP = 'b1000000-0000-4000-8000-000000000001';

test('registro: 4 pruebas y validación de definiciones', () => {
  assert.deepEqual(testRegistry.list().map((p) => p.codigo).sort(), ['atencion_cancelacion', 'memoria_secuencias', 'reaccion_simple', 'stroop_adaptado']);
  const r = new TestRegistry();
  assert.throws(() => r.register({ codigo: 'X', ejecutar() {}, crudo() {}, instrucciones: [] }), TypeError);
  assert.throws(() => r.register({ codigo: 'abc', instrucciones: [] }), TypeError);
  const def = { codigo: 'abc', ejecutar() {}, crudo() {}, instrucciones: [] };
  r.register(def);
  assert.throws(() => r.register(def), /ya está registrada/);
});

test('atención: tablero determinista con mínimo de objetivos y conteo de errores', () => {
  const a = generarTablero({}, crearRng(7));
  const b = generarTablero({}, crearRng(7));
  assert.deepEqual(a, b);
  assert.equal(a.celdas.length, 42);
  assert.ok(a.celdas.filter((s) => s === a.objetivo).length >= 8);
  assert.throws(() => generarTablero({ celdas: 3, minimoObjetivos: 5 }), RangeError);
  const ev = evaluarCancelacion({ celdas: ['a', 'b', 'a', 'a'], objetivo: 'a', marcadas: new Set([0, 2]), clicsErroneos: 1 });
  assert.deepEqual(ev, { objetivos: 3, aciertos: 2, omisiones: 1, clicsErroneos: 1, errores: 2 });
  const r = resumirAtencion(ev, 1234.6);
  assert.equal(r.tiempo_total_ms, 1235);
  assert.equal(r.errores_totales, 2);
});

test('stroop: ítems incongruentes y resumen', () => {
  const items = generarItems(12, crearRng(3));
  assert.equal(items.length, 12);
  assert.ok(items.every((i) => i.color && i.palabra));
  const r = resumirStroop([{ correcta: true, ms: 500 }, { correcta: false, ms: 700 }], 1300);
  assert.equal(r.errores_totales, 1);
  assert.equal(r.metricas.aciertos, 1);
  assert.equal(r.metricas.tiempo_medio_respuesta_ms, 600);
});

test('memoria: secuencias crecientes sin repetición consecutiva y máquina de estados', () => {
  const seqs = generarSecuencias(6, 6, crearRng(11));
  seqs.forEach((s, i) => {
    assert.equal(s.length, i + 1);
    s.slice(1).forEach((v, j) => assert.notEqual(v, s[j]));
  });
  assert.throws(() => generarSecuencias(0), RangeError);
  const s = crearSesionMemoria([[1], [2, 3], [0, 1, 2]]);
  assert.deepEqual(s.ingresar(1), { correcto: true, rondaCompleta: true, rondaPerdida: false });
  assert.equal(s.ingresar(2).correcto, true);
  assert.equal(s.ingresar(5).rondaPerdida, true);
  assert.equal(s.nivel, 2);
  s.ingresar(0); s.ingresar(1); s.ingresar(2);
  assert.equal(s.terminada, true);
  assert.throws(() => s.ingresar(0), /ya terminó/);
  const res = s.resumen();
  assert.deepEqual(res, { rondas: 3, rondasCorrectas: 2, nivelMax: 3, errores: 1 });
  assert.equal(resumirMemoria(res, 900).metricas.rondas_correctas, 2);
});

test('reacción: esperas en rango, anticipos como errores, sin ensayos válidos', () => {
  const e = generarEsperas(50, { min: 1500, max: 4500 }, crearRng(5));
  assert.ok(e.every((x) => x >= 1500 && x <= 4500));
  assert.throws(() => generarEsperas(0), RangeError);
  const r = resumirReaccion([{ ms: 300, anticipo: false }, { ms: 400, anticipo: false }, { ms: null, anticipo: true }]);
  assert.equal(r.tiempo_total_ms, 350);
  assert.equal(r.errores_totales, 1);
  assert.equal(r.metricas.mediana_ms, 350);
  const vacio = resumirReaccion([{ ms: null, anticipo: true }]);
  assert.equal(vacio.tiempo_total_ms, null);
  assert.deepEqual(crudoReaccion(vacio, 'x', { tiempo_peor_ms: 500 }), { tiempo_ms: 500, errores: 1 });
});

// ---------------------------------------------------------------- servicio
const version = (id, funcion, parametros) => ({ id, version: 1, funcion_puntuacion: funcion, parametros, estado: 'experimental' });
const PRUEBAS = [
  { id: 'p1', codigo: 'reaccion_simple', nombre: 'R', categoria: 'velocidad', activa: true,
    version_actual: version('v1', 'compuesta_tiempo_errores', { tiempo_mejor_ms: 200, tiempo_peor_ms: 500, errores_maximo: 5, peso_tiempo: 0.7 }) },
  { id: 'p2', codigo: 'memoria_secuencias', nombre: 'M', categoria: 'memoria', activa: true,
    version_actual: version('v2', 'lineal_mayor_mejor', { minimo: 0, maximo: 6 }) },
  { id: 'p3', codigo: 'prueba_desconocida', nombre: 'X', categoria: 'atencion', activa: true, version_actual: version('v3', 'lineal_mayor_mejor', {}) },
  { id: 'p4', codigo: 'stroop_adaptado', nombre: 'S', categoria: 'inhibicion', activa: true, version_actual: null },
];

function crearServicio({ evaluar, guardar } = {}) {
  const llamadas = [];
  const servicio = new EvaluacionService({
    testing: { listarActivas: async () => PRUEBAS, registrar: async (p) => { llamadas.push(p); return { evaluacion_id: p.evaluacion_id, duplicada: false }; } },
    motor: { evaluar: evaluar ?? (async ({ puntajes }) => ({ ico: { valor: 72.5, motivo: null }, clasificacion: { nivel: 'aceptable' }, icoConfiguracionId: 'cfg1', baremoId: 'bar1', puntajes })) },
    registro: testRegistry,
    guardar,
    generarId: () => 'e0000000-0000-4000-8000-000000000001',
    dispositivoId: 'disp-1',
  });
  return { servicio, llamadas };
}

const ejecuciones = (servicio, pruebas) => pruebas.map((e) => ({
  ...e,
  resultado: e.prueba.codigo === 'reaccion_simple'
    ? { tiempo_total_ms: 350, errores_totales: 1, metricas: {} }
    : { tiempo_total_ms: 5000, errores_totales: 0, metricas: { rondas_correctas: 3 } },
}));

test('servicio: filtra por registro, versión vigente y pruebas_activas de la empresa', async () => {
  const { servicio } = crearServicio();
  assert.deepEqual((await servicio.cargarPruebas(null)).map((p) => p.prueba.codigo), ['reaccion_simple', 'memoria_secuencias']);
  assert.deepEqual((await servicio.cargarPruebas({ pruebas_activas: ['memoria_secuencias'] })).map((p) => p.prueba.codigo), ['memoria_secuencias']);
  assert.deepEqual(await servicio.cargarPruebas({ pruebas_activas: ['nada'] }), []);
});

test('servicio: normaliza, calcula ICO y arma el payload trazable', async () => {
  const { servicio } = crearServicio();
  const pruebas = await servicio.cargarPruebas(null);
  const { payload, resumen } = await servicio.cerrar({ empresaId: EMP, operador: { id: OP, cargo_id: null }, turno: ' Diurno ', ejecuciones: ejecuciones(servicio, pruebas) });
  assert.equal(payload.turno, 'Diurno');
  assert.equal(payload.ico_valor, 72.5);
  assert.equal(payload.ico_nivel, 'aceptable');
  assert.equal(payload.ico_configuracion_id, 'cfg1');
  assert.equal(payload.baremo_snapshot_id, 'bar1');
  assert.equal(payload.dispositivo_id, 'disp-1');
  assert.equal(payload.resultados.length, 2);
  assert.equal(payload.resultados[1].puntaje_normalizado, 50); // 3 de 6 rondas
  assert.ok(payload.resultados[0].puntaje_normalizado > 0 && payload.resultados[0].puntaje_normalizado < 100);
  assert.ok(!('codigo' in payload.resultados[0]));
  assert.equal(resumen.resultados[0].codigo, 'reaccion_simple');
});

test('servicio: sin configuración científica registra ico nulo; otros errores propagan', async () => {
  const sinConfig = crearServicio({ evaluar: async () => { throw new ScientificError(CODIGOS_CIENTIFICOS.CONFIGURACION_NO_ENCONTRADA, 'x'); } });
  const pruebas = await sinConfig.servicio.cargarPruebas(null);
  const r = await sinConfig.servicio.cerrar({ empresaId: EMP, operador: { id: OP }, turno: 'Diurno', ejecuciones: ejecuciones(sinConfig.servicio, pruebas) });
  assert.equal(r.payload.ico_valor, null);
  assert.equal(r.payload.ico_configuracion_id, null);
  assert.equal(r.resumen.configuracionFaltante, true);

  const roto = crearServicio({ evaluar: async () => { throw new ScientificError(CODIGOS_CIENTIFICOS.PESOS_INVALIDOS, 'x'); } });
  await assert.rejects(() => roto.servicio.cerrar({ empresaId: EMP, operador: { id: OP }, turno: 'D', ejecuciones: ejecuciones(roto.servicio, pruebas) }), ScientificError);
});

test('servicio: valida entrada y guarda de forma inyectable/idempotente', async () => {
  const { servicio, llamadas } = crearServicio();
  const pruebas = await servicio.cargarPruebas(null);
  const base = { empresaId: EMP, operador: { id: OP }, turno: 'D', ejecuciones: ejecuciones(servicio, pruebas) };
  await assert.rejects(() => servicio.cerrar({ ...base, empresaId: 'no-uuid' }), EvaluacionError);
  await assert.rejects(() => servicio.cerrar({ ...base, turno: ' ' }), EvaluacionError);
  await assert.rejects(() => servicio.cerrar({ ...base, ejecuciones: [] }), EvaluacionError);
  const { payload } = await servicio.cerrar(base);
  await servicio.guardar(payload);
  await servicio.guardar(payload); // reintento: mismo evaluacion_id
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[0].evaluacion_id, llamadas[1].evaluacion_id);
});

test('turnos: por defecto, strings y objetos', () => {
  assert.deepEqual(turnosDeEmpresa(null), ['Diurno', 'Nocturno']);
  assert.deepEqual(turnosDeEmpresa({ turnos: [] }), ['Diurno', 'Nocturno']);
  assert.deepEqual(turnosDeEmpresa({ turnos: ['Mañana', { nombre: ' Tarde ' }, { x: 1 }] }), ['Mañana', 'Tarde']);
});
