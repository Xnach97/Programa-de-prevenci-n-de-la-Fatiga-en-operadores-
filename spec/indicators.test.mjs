import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  icoMedia, indiceAtencion, indiceFatiga, indiceRiesgo, evaluacionValida, calcularIndicadoresOperador,
  calcularIndicadoresGrupo, ventanas, fechaLocal, sumarDias, inicioDiaLocalISO, redondear,
} from '../statistics/indicadores.js';
import { IndicadoresService } from '../services/indicadores-service.js';

const res = (categoria, puntaje, valido = true) => ({ categoria, puntaje, valido });
const ev = (ico, nivel, resultados, estado = 'completa') => ({ ico_valor: ico, ico_nivel: nivel, estado, resultados });

const EVALS = [
  ev(80, 'excelente', [res('atencion', 90), res('velocidad', 70), res('memoria', 50)]),
  ev(40, 'requiere_atencion', [res('atencion', 50), res('velocidad', 30)]),
  ev(99, 'excelente', [res('atencion', 100, false)]),              // intento repetido: no cuenta
  ev(10, 'requiere_atencion', [res('atencion', 0)], 'descartada'), // descartada: no cuenta
];

test('evaluación válida: completa y con todos los resultados del primer intento', () => {
  assert.equal(evaluacionValida(EVALS[0]), true);
  assert.equal(evaluacionValida(EVALS[2]), false);
  assert.equal(evaluacionValida(EVALS[3]), false);
  assert.equal(evaluacionValida(ev(1, null, [])), false);
  assert.equal(evaluacionValida(null), false);
});

test('fórmulas por operador (excluyen inválidas) y redondeo a 3 decimales', () => {
  assert.deepEqual(icoMedia(EVALS), { valor: 60, n: 2 });
  assert.deepEqual(indiceAtencion(EVALS), { valor: 70, n: 2 });                 // (90+50)/2
  assert.deepEqual(indiceFatiga(EVALS), { valor: 40, n: 4 });                   // 100 − media(90,70,50,30)=60
  assert.deepEqual(indiceRiesgo(EVALS), { valor: 50, n: 2 });
  assert.equal(icoMedia([]), null);
  assert.equal(indiceRiesgo([ev(50, null, [res('atencion', 1)])]), null);       // sin nivel no hay riesgo calculable
  assert.equal(redondear(33.33333), 33.333);
  assert.equal(redondear(120), 100);
  assert.equal(redondear(-5), 0);
});

test('calcularIndicadoresOperador: solo los calculables, con detalle', () => {
  const r = calcularIndicadoresOperador(EVALS);
  assert.deepEqual(r.map((x) => x.codigo), ['ico_trabajador', 'indice_atencion', 'indice_memoria', 'indice_velocidad', 'indice_fatiga', 'indice_riesgo']);
  assert.equal(r.find((x) => x.codigo === 'indice_memoria').valor, 50);
  assert.equal(r.find((x) => x.codigo === 'indice_velocidad').valor, 50);   // (70+30)/2
  assert.equal(r[0].detalle.evaluaciones_validas, 2);
  assert.deepEqual(calcularIndicadoresOperador([]), []);
  const soloMemoria = calcularIndicadoresOperador([ev(70, 'aceptable', [res('memoria', 70)])]);
  assert.deepEqual(soloMemoria.map((x) => x.codigo), ['ico_trabajador', 'indice_memoria', 'indice_riesgo']);
});

test('grupo: cada operador pesa igual; área/cargo/empresa', () => {
  const E = 'c1000000-0000-4000-8000-00000000000a';
  const r = calcularIndicadoresGrupo({
    empresaId: E,
    operadores: [
      { operadorId: 'o1', areaId: 'A1', cargoId: 'C1', ico: 80, fatiga: 20, riesgo: 0 },
      { operadorId: 'o2', areaId: 'A1', cargoId: 'C2', ico: 40, fatiga: 60, riesgo: 100 },
      { operadorId: 'o3', areaId: null, cargoId: null, ico: 60 },
    ],
  });
  const v = (codigo, id) => r.find((x) => x.codigo === codigo && x.ambitoId === id);
  assert.equal(v('ico_empresa', E).valor, 60);
  assert.equal(v('ico_empresa', E).detalle.n_operadores, 3);
  assert.equal(v('ico_area', 'A1').valor, 60);
  assert.equal(v('ico_cargo', 'C2').valor, 40);
  assert.equal(v('indice_fatiga_empresa', E).valor, 40);
  assert.equal(v('indice_riesgo_empresa', E).valor, 50);
  assert.equal(v('indice_riesgo_area', 'A1').valor, 50);
  assert.equal(r.filter((x) => x.ambitoId === null || x.ambitoId === undefined).length, 0);
  assert.throws(() => calcularIndicadoresGrupo({ empresaId: '', operadores: [] }));
});

test('ventanas y fechas locales de Colombia', () => {
  assert.equal(fechaLocal('2026-10-16T03:30:00Z'), '2026-10-15'); // 22:30 en Bogotá
  assert.equal(fechaLocal('2026-10-16T05:00:00Z'), '2026-10-16');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(ventanas('2026-10-15'), {
    diario: { desde: '2026-10-15', hasta: '2026-10-16' },
    mensual: { desde: '2026-09-16', hasta: '2026-10-16' },
  });
  assert.equal(inicioDiaLocalISO('2026-10-15'), '2026-10-15T05:00:00.000Z');
  assert.throws(() => sumarDias('15/10/2026', 1));
  assert.throws(() => fechaLocal('no es fecha'));
});

// ---------------------------------------------------------------- servicio
const E = 'c1000000-0000-4000-8000-00000000000a';
const OP1 = 'b1000000-0000-4000-8000-000000000001';
const OP2 = 'b1000000-0000-4000-8000-000000000002';

function repoFalso() {
  const publicado = [];
  const almacen = new Map(); // `${codigo}|${ambito}|${desde}|${hasta}` -> fila
  let lecturaMapa = 0;
  return {
    publicado, get lecturasMapa() { return lecturaMapa; },
    async mapaOperadores() { lecturaMapa += 1; return new Map([[OP1, { areaId: 'a1', cargoId: 'c1' }], [OP2, { areaId: 'a1', cargoId: 'c2' }]]); },
    async evaluacionesDeOperador(id) { return id === OP1 ? EVALS : [ev(40, 'requiere_atencion', [res('atencion', 20)])]; },
    async publicar(emp, filas) {
      assert.equal(emp, E);
      for (const f of filas) { almacen.set(`${f.codigo}|${f.ambito_id}|${f.desde}|${f.hasta}`, f); publicado.push(f); }
      return filas.length;
    },
    async leer({ codigos, desde, hasta, exacto }) {
      assert.equal(exacto, true);
      return [...almacen.values()].filter((f) => codigos.includes(f.codigo) && f.desde === desde && f.hasta === hasta);
    },
  };
}

test('servicio: recalcula operador y agrega grupo en ambas ventanas; idempotente', async () => {
  const repo = repoFalso();
  let t = 0;
  const servicio = new IndicadoresService({ indicadores: repo, ahora: () => t });
  await servicio.recalcularTrasEvaluacion({ empresaId: E, operadorId: OP1, fecha: '2026-10-15T15:00:00Z' });
  await servicio.recalcularTrasEvaluacion({ empresaId: E, operadorId: OP2, fecha: '2026-10-15T16:00:00Z' });
  const emp = repo.publicado.filter((f) => f.codigo === 'ico_empresa' && f.desde === '2026-10-15' && f.hasta === '2026-10-16');
  assert.equal(emp.length, 2);
  assert.equal(emp[0].valor, 60);            // solo OP1 todavía
  assert.equal(emp[1].valor, 50);            // media(60, 40)
  assert.equal(emp[1].ambito_id, E);
  assert.ok(repo.publicado.some((f) => f.desde === '2026-09-16')); // ventana de 30 días
  assert.ok(repo.publicado.some((f) => f.codigo === 'ico_area' && f.ambito_id === 'a1'));
  assert.equal(repo.lecturasMapa, 1, 'el mapa de operadores se reutiliza dentro del TTL');
  t = 6 * 60_000;
  await servicio.recalcularTrasEvaluacion({ empresaId: E, operadorId: OP1, fecha: '2026-10-15T17:00:00Z' });
  assert.equal(repo.lecturasMapa, 2, 'tras el TTL se vuelve a leer');
});

test('servicio: sin evaluaciones válidas no publica nada', async () => {
  const repo = repoFalso();
  repo.evaluacionesDeOperador = async () => [EVALS[2]];
  const r = await new IndicadoresService({ indicadores: repo }).recalcularTrasEvaluacion({ empresaId: E, operadorId: OP1, fecha: new Date() });
  assert.equal(r.publicados, 0);
  assert.equal(repo.publicado.length, 0);
});
