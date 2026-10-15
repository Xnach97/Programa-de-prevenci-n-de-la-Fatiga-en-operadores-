import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escalaLineal, ticksAgradables, segmentos, rutaLinea, puntosRadar, extremoEje, esPeriodoDiario, diasEntre, serieDiaria, etiquetaDia, etiquetaAnonima, poligono,
} from '../dashboard/chart-math.js';

test('escala lineal: mapea, invierte y tolera dominio degenerado', () => {
  const y = escalaLineal([0, 100], [200, 0]);
  assert.equal(y(0), 200);
  assert.equal(y(100), 0);
  assert.equal(y(25), 150);
  assert.equal(escalaLineal([5, 5], [0, 10])(5), 5);
});

test('ticks agradables', () => {
  assert.deepEqual(ticksAgradables(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(ticksAgradables(0, 1, 4), [0, 0.5, 1]);
  assert.deepEqual(ticksAgradables(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(ticksAgradables(3, 3), [3]);
  assert.deepEqual(ticksAgradables(0, 7, 7), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => ticksAgradables(5, 1), RangeError);
  assert.throws(() => ticksAgradables(NaN, 1), RangeError);
});

test('segmentos y rutas: los huecos cortan la línea, no se interpolan', () => {
  const pts = [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: null }, { x: 3, y: 30 }, { x: 4, y: undefined }, { x: 5, y: NaN }];
  const tramos = segmentos(pts);
  assert.equal(tramos.length, 2);
  assert.equal(rutaLinea(tramos[0]), 'M0 10L1 20');
  assert.equal(rutaLinea(tramos[1]), 'M3 30h0');
  assert.equal(rutaLinea([]), '');
  assert.deepEqual(segmentos([]), []);
});

test('radar: primer eje arriba, sentido horario, valores acotados y nulos en el centro', () => {
  const p = puntosRadar([100, 100, 100, 100], 100, 50, 50, 40);
  assert.deepEqual([p[0].x, p[0].y], [50, 10]);   // arriba
  assert.deepEqual([p[1].x, p[1].y], [90, 50]);   // derecha
  assert.deepEqual([p[2].x, p[2].y], [50, 90]);   // abajo
  const c = puntosRadar([null, 250, -5, 50], 100, 50, 50, 40);
  assert.deepEqual([c[0].x, c[0].y], [50, 50]);
  assert.deepEqual([c[1].x, c[1].y], [90, 50]);   // 250 se acota a 100
  assert.deepEqual([c[2].x, c[2].y], [50, 50]);   // negativo → 0
  assert.deepEqual(extremoEje(0, 4, 50, 50, 40).y, 10);
  assert.equal(poligono([{ x: 1, y: 2 }, { x: 3, y: 4 }]), '1,2 3,4');
});

test('series diarias: continuidad, huecos como null y periodos de un día', () => {
  assert.deepEqual(diasEntre('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(esPeriodoDiario({ desde: '2026-10-15', hasta: '2026-10-16' }), true);
  assert.equal(esPeriodoDiario({ desde: '2026-09-16', hasta: '2026-10-16' }), false);
  const s = serieDiaria([{ desde: '2026-10-14', valor: 60 }, { desde: '2026-10-16', valor: 70 }], '2026-10-14', '2026-10-16');
  assert.deepEqual(s, [{ dia: '2026-10-14', valor: 60 }, { dia: '2026-10-15', valor: null }, { dia: '2026-10-16', valor: 70 }]);
  assert.equal(etiquetaDia('2026-10-05'), '05/10');
});

test('etiqueta anónima: estable, sin revelar el id y distinta entre ids', () => {
  const a = etiquetaAnonima('b1000000-0000-4000-8000-000000000001');
  assert.equal(a, etiquetaAnonima('b1000000-0000-4000-8000-000000000001'));
  assert.notEqual(a, etiquetaAnonima('b1000000-0000-4000-8000-000000000002'));
  assert.match(a, /^O-[0-9A-Z]{6}$/);
  assert.ok(!a.includes('b1000000'));
});

import { DashboardService } from '../dashboard/dashboard-service.js';
import { validarFlags } from '../services/configuracion-service.js';

const EMP = 'c1000000-0000-4000-8000-00000000000a';
const OPS = [1, 2, 3, 4, 5, 6].map((i) => `b100000${i}-0000-4000-8000-00000000000${i}`);
const fila = (codigo, ambito_id, desde, hasta, valor) => ({ codigo, ambito_id, desde, hasta, valor, detalle: {} });

function servicioFalso(filas) {
  const llamadas = [];
  return {
    llamadas,
    servicio: new DashboardService({
      indicadores: {
        leer: async (f) => {
          llamadas.push(f);
          return filas.filter((x) => f.codigos.includes(x.codigo) && (!f.ambitoId || x.ambito_id === f.ambitoId)
            && (f.exacto ? x.desde === f.desde && x.hasta === f.hasta : x.desde >= f.desde && x.hasta <= f.hasta));
        },
      },
      reglas: { listarAlertas: async () => ({ filas: [], total: 2 }), recomendacionesDeOperador: async () => [] },
      operadores: null,
      catalogos: { listar: async () => [] },
    }),
  };
}

test('dashboard operativo: lee solo indicadores, etiquetas anónimas sin permiso de nombres', async () => {
  const filas = OPS.slice(0, 3).map((o, i) => fila('ico_trabajador', o, '2026-10-15', '2026-10-16', [80, 40, 60][i]));
  filas.push(fila('indice_riesgo', OPS[1], '2026-10-15', '2026-10-16', 2));
  const { servicio, llamadas } = servicioFalso(filas);
  const d = await servicio.operativo(EMP, '2026-10-15');
  assert.equal(d.kpis.evaluados, 3);
  assert.equal(d.kpis.icoPromedio, 60);
  assert.equal(d.kpis.enRiesgo, 1);
  assert.equal(d.kpis.alertasAbiertas, 2);
  assert.equal(d.operadores[0].ico, 40);
  assert.match(d.operadores[0].etiqueta, /^O-/);
  assert.ok(llamadas.every((l) => l.empresaId === EMP && l.exacto === true));
});

test('dashboard científico: n=0 no falla; con datos calcula resumen y marca atípicos anónimos', async () => {
  const vacio = await servicioFalso([]).servicio.cientifico(EMP, '2026-10-15');
  assert.equal(vacio.n, 0);
  const valores = [60, 61, 62, 63, 64, 62, 98];
  const filas = valores.map((v, i) => fila('ico_trabajador', OPS[i % 6] + i, '2026-10-15', '2026-10-16', v));
  const d = await servicioFalso(filas).servicio.cientifico(EMP, '2026-10-15');
  assert.equal(d.n, 7);
  assert.equal(d.atipicos.length, 1);
  assert.equal(d.atipicos[0].valor, 98);
  assert.match(d.atipicos[0].etiqueta, /^O-/);
  assert.equal(d.histograma.conteos.reduce((a, b) => a + b, 0), 7);
  assert.ok(d.curva.length > 10);
});

test('dashboard clínico: serie diaria sin interpolar y periodos mensuales excluidos', async () => {
  const op = OPS[0];
  const filas = [fila('ico_trabajador', op, '2026-10-13', '2026-10-14', 70), fila('ico_trabajador', op, '2026-10-15', '2026-10-16', 74), fila('ico_trabajador', op, '2026-09-17', '2026-10-16', 99)];
  const d = await servicioFalso(filas).servicio.clinico(EMP, op, '2026-10-15');
  assert.equal(d.serie.length, 30);
  const por = Object.fromEntries(d.serie.map((p) => [p.dia, p.valor]));
  assert.equal(por['2026-10-13'], 70);
  assert.equal(por['2026-10-14'], null);
  assert.equal(por['2026-10-15'], 74);
  assert.equal(d.radar.length, 4);
  assert.ok(d.radar.every((r) => r.valor === null));
});

test('banderas de funcionalidad: solo booleanos con nombre seguro', () => {
  assert.deepEqual(validarFlags({ dashboard_cientifico: true }), { dashboard_cientifico: true });
  assert.throws(() => validarFlags({ dashboard_cientifico: 'si' }));
  assert.throws(() => validarFlags({ 'x;drop': true }));
  assert.throws(() => validarFlags([]));
});
