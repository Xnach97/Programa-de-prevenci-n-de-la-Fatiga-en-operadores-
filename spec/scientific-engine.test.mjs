/**
 * @file spec/scientific-engine.test.mjs
 * @description Pruebas de score, ICO, baremos y ScientificService.
 * Ejecutar: node --test spec/scientific-engine.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { puntuar, registrarFuncionPuntuacion, listarFuncionesPuntuacion, normalizarLineal, FUNCIONES_PUNTUACION as F } from '../statistics/score.js';
import { calcularICO, validarPesos, seleccionarConfiguracionICO } from '../statistics/ico.js';
import {
  crearEstrategia, seleccionarBaremoVigente, calcularParametrosDinamicos, limitesDeParametros, nivelDeValor, NIVELES,
} from '../statistics/baremos.js';
import { ScientificError } from '../statistics/scientific-error.js';
import { ScientificService, ConfiguracionCientificaService } from '../services/scientific-service.js';
import { IcoConfiguracionesRepository, BaremosRepository } from '../js/repositories/scientific-repository.js';

const cerca = (real, esperado, tol = 1e-9) => assert.ok(Math.abs(real - esperado) <= tol, `${real} ≠ ${esperado}`);
const codigo = (c) => (e) => e instanceof ScientificError && e.codigo === c;

// ------------------------------- score -------------------------------------

test('normalizarLineal: extremos, saturación y orientación invertida', () => {
  cerca(normalizarLineal(150, 500, 150), 100);
  cerca(normalizarLineal(500, 500, 150), 0);
  cerca(normalizarLineal(325, 500, 150), 50);
  cerca(normalizarLineal(100, 500, 150), 100); // satura
  cerca(normalizarLineal(900, 500, 150), 0);
  assert.throws(() => normalizarLineal(1, 5, 5), ScientificError);
});

test('lineal_menor_mejor y lineal_mayor_mejor', () => {
  assert.equal(puntuar(F.LINEAL_MENOR_MEJOR, 250, { mejor: 150, peor: 450 }), 66.67);
  assert.equal(puntuar(F.LINEAL_MENOR_MEJOR, { valor: 150 }, { mejor: 150, peor: 450 }), 100);
  assert.equal(puntuar(F.LINEAL_MAYOR_MEJOR, 7, { minimo: 3, maximo: 9 }), 66.67);
  assert.throws(() => puntuar(F.LINEAL_MENOR_MEJOR, 250, { mejor: 150 }), codigo('entrada_invalida'));
  assert.throws(() => puntuar(F.LINEAL_MENOR_MEJOR, NaN, { mejor: 1, peor: 2 }), ScientificError);
});

test('compuesta_tiempo_errores pondera tiempo y errores', () => {
  const params = { tiempo_mejor_ms: 200, tiempo_peor_ms: 600, errores_maximo: 4 };
  assert.equal(puntuar(F.COMPUESTA_TIEMPO_ERRORES, { tiempo_ms: 200, errores: 0 }, params), 100);
  assert.equal(puntuar(F.COMPUESTA_TIEMPO_ERRORES, { tiempo_ms: 400, errores: 2 }, params), 50);
  assert.equal(puntuar(F.COMPUESTA_TIEMPO_ERRORES, { tiempo_ms: 200, errores: 4 }, { ...params, peso_tiempo: 1 }), 100);
  assert.equal(puntuar(F.COMPUESTA_TIEMPO_ERRORES, { tiempo_ms: 700, errores: 9 }, params), 0);
  assert.throws(() => puntuar(F.COMPUESTA_TIEMPO_ERRORES, { tiempo_ms: 1, errores: 1 }, { ...params, peso_tiempo: 2 }), ScientificError);
});

test('percentil_gaussiano: mediana = 50 y simetría por dirección', () => {
  const p = { media: 300, desviacion: 50 };
  assert.equal(puntuar(F.PERCENTIL_GAUSSIANO, 300, p), 50);
  assert.equal(puntuar(F.PERCENTIL_GAUSSIANO, 350, p), 15.87); // más lento = peor
  assert.equal(puntuar(F.PERCENTIL_GAUSSIANO, 350, { ...p, direccion: 'mayor_mejor' }), 84.13);
  assert.throws(() => puntuar(F.PERCENTIL_GAUSSIANO, 1, { media: 1, desviacion: 0 }), ScientificError);
});

test('registro: función desconocida, sin sobrescritura y validación del resultado', () => {
  assert.throws(() => puntuar('no_existe', 1), codigo('funcion_puntuacion_desconocida'));
  registrarFuncionPuntuacion('prueba_dummy_malsana', () => 130);
  assert.throws(() => puntuar('prueba_dummy_malsana', 1), codigo('puntaje_fuera_de_rango'));
  registrarFuncionPuntuacion('prueba_dummy_nan', () => NaN);
  assert.throws(() => puntuar('prueba_dummy_nan', 1), codigo('puntaje_fuera_de_rango'));
  registrarFuncionPuntuacion('prueba_dummy_ok', (x) => x);
  assert.equal(puntuar('prueba_dummy_ok', 33.456), 33.46);
  assert.throws(() => registrarFuncionPuntuacion('prueba_dummy_ok', () => 1), ScientificError);
  assert.throws(() => registrarFuncionPuntuacion('', () => 1), ScientificError);
  assert.ok(listarFuncionesPuntuacion().includes(F.LINEAL_MENOR_MEJOR));
});

// -------------------------------- ICO --------------------------------------

test('validarPesos', () => {
  assert.equal(validarPesos({ b: 1, a: 2 })[0][0], 'a'); // ordenados
  for (const malo of [null, [], {}, { a: 0 }, { a: -1 }, { a: '5' }, { a: NaN }]) {
    assert.throws(() => validarPesos(malo), codigo('pesos_invalidos'), JSON.stringify(malo));
  }
});

test('calcularICO: promedio ponderado con pesos relativos', () => {
  const r = calcularICO({ atencion: 80, stroop: 60, memoria: 100, reaccion: 70 }, { atencion: 25, stroop: 25, memoria: 20, reaccion: 30 });
  cerca(r.valor, 0.25 * 80 + 0.25 * 60 + 0.2 * 100 + 0.3 * 70, 0.005);
  assert.equal(r.valor, 76);
  assert.equal(r.cobertura, 1);
  assert.deepEqual(r.faltantes, []);
  cerca(r.detalle.reduce((s, d) => s + d.pesoEfectivo, 0), 1);
  // mismos pesos escalados dan el mismo ICO
  assert.equal(calcularICO({ a: 90, b: 50 }, { a: 1, b: 1 }).valor, calcularICO({ a: 90, b: 50 }, { a: 500, b: 500 }).valor);
});

test('calcularICO: pruebas faltantes según cobertura mínima', () => {
  const pesos = { a: 50, b: 30, c: 20 };
  const estricto = calcularICO({ a: 80, b: 60 }, pesos);
  assert.equal(estricto.valor, null);
  assert.equal(estricto.motivo, 'cobertura_insuficiente');
  assert.deepEqual(estricto.faltantes, ['c']);
  cerca(estricto.cobertura, 0.8);
  const flexible = calcularICO({ a: 80, b: 60 }, pesos, { coberturaMinima: 0.8 });
  assert.equal(flexible.valor, 72.5); // (80·50 + 60·30) / 80
  assert.equal(calcularICO({}, pesos, { coberturaMinima: 0.1 }).valor, null);
  assert.throws(() => calcularICO({ a: 1 }, pesos, { coberturaMinima: 0 }), ScientificError);
});

test('calcularICO: peso 0 no es requerido; puntajes sin peso se reportan; fuera de rango lanza', () => {
  const r = calcularICO({ a: 80, extra: 10 }, { a: 1, b: 0 });
  assert.equal(r.valor, 80);
  assert.deepEqual(r.sinPeso, ['extra']);
  assert.throws(() => calcularICO({ a: 101 }, { a: 1 }), codigo('puntaje_fuera_de_rango'));
  assert.throws(() => calcularICO({ a: '80' }, { a: 1 }), codigo('puntaje_fuera_de_rango'));
  assert.throws(() => calcularICO({ a: -1 }, { a: 1 }), ScientificError);
});

test('seleccionarConfiguracionICO: vigencia [desde, hasta) y prioridad del cargo', () => {
  const configs = [
    { id: 'v1', cargo_id: null, pesos: {}, vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: '2026-06-01T00:00:00Z' },
    { id: 'v2', cargo_id: null, pesos: {}, vigente_desde: '2026-06-01T00:00:00Z', vigente_hasta: null },
    { id: 'c1', cargo_id: 'cargoX', pesos: {}, vigente_desde: '2026-03-01T00:00:00Z', vigente_hasta: null },
  ];
  assert.equal(seleccionarConfiguracionICO(configs, { fecha: '2026-02-01T00:00:00Z' }).id, 'v1');
  assert.equal(seleccionarConfiguracionICO(configs, { fecha: '2026-06-01T00:00:00Z' }).id, 'v2'); // límite: la nueva
  assert.equal(seleccionarConfiguracionICO(configs, { fecha: '2026-07-01T00:00:00Z', cargoId: 'cargoX' }).id, 'c1');
  assert.equal(seleccionarConfiguracionICO(configs, { fecha: '2026-07-01T00:00:00Z', cargoId: 'otro' }).id, 'v2');
  assert.equal(seleccionarConfiguracionICO(configs, { fecha: '2026-02-01T00:00:00Z', cargoId: 'cargoX' }).id, 'v1'); // c1 aún no vigente
  assert.throws(() => seleccionarConfiguracionICO(configs, { fecha: '2025-01-01T00:00:00Z' }), codigo('configuracion_no_encontrada'));
  assert.throws(() => seleccionarConfiguracionICO([], {}), codigo('configuracion_no_encontrada'));
  assert.throws(() => seleccionarConfiguracionICO(configs, { fecha: 'basura' }), codigo('entrada_invalida'));
});

// ------------------------------- baremos -----------------------------------

test('límites μ∓σ y clasificación estricta (menor_mejor = legado)', () => {
  const lim = limitesDeParametros({ media: 300, desviacion: 50 });
  assert.deepEqual([lim.excelente, lim.atencion], [250, 350]);
  assert.equal(nivelDeValor(249, lim), NIVELES.EXCELENTE);
  assert.equal(nivelDeValor(250, lim), NIVELES.ACEPTABLE); // el límite pertenece a "aceptable"
  assert.equal(nivelDeValor(350, lim), NIVELES.ACEPTABLE);
  assert.equal(nivelDeValor(351, lim), NIVELES.REQUIERE_ATENCION);
  assert.throws(() => nivelDeValor(NaN, lim), ScientificError);
});

test('mayor_mejor espeja los límites', () => {
  const lim = limitesDeParametros({ media: 70, desviacion: 10, direccion: 'mayor_mejor' });
  assert.deepEqual([lim.excelente, lim.atencion], [80, 60]);
  assert.equal(nivelDeValor(81, lim), NIVELES.EXCELENTE);
  assert.equal(nivelDeValor(70, lim), NIVELES.ACEPTABLE);
  assert.equal(nivelDeValor(59, lim), NIVELES.REQUIERE_ATENCION);
});

test('parámetros de baremo inválidos se rechazan al construir', () => {
  for (const mal of [
    {}, { media: 1 }, { media: 1, desviacion: 0 }, { media: 1, desviacion: -2 },
    { umbrales: { excelente: 500, atencion: 400 } },
    { umbrales: { excelente: 60, atencion: 80 }, direccion: 'mayor_mejor' },
    { umbrales: { excelente: 1 } }, { media: 1, desviacion: 1, direccion: 'arriba' },
  ]) {
    assert.throws(() => limitesDeParametros(mal), codigo('baremo_invalido'), JSON.stringify(mal));
  }
  assert.throws(() => crearEstrategia({ modalidad: 'otra', parametros: {} }), codigo('baremo_invalido'));
  assert.throws(() => crearEstrategia({ modalidad: 'dinamico', parametros: { ventana_dias: 0, minimo_registros: 5 } }), codigo('baremo_invalido'));
});

test('estrategia institucional con umbrales explícitos y z cuando hay μ/σ', () => {
  const e = crearEstrategia({ modalidad: 'institucional', parametros: { umbrales: { excelente: 200, atencion: 400 }, media: 300, desviacion: 50 } });
  const r = e.clasificar(150);
  assert.equal(r.nivel, NIVELES.EXCELENTE);
  assert.equal(r.modalidad, 'institucional');
  cerca(r.z, -3);
  assert.equal(crearEstrategia({ modalidad: 'institucional', parametros: { umbrales: { excelente: 200, atencion: 400 } } }).clasificar(300).z, null);
});

test('estrategia científica usa los mismos límites y se identifica como tal', () => {
  const r = crearEstrategia({ modalidad: 'cientifico', parametros: { media: 250, desviacion: 40 } }).clasificar(400);
  assert.equal(r.nivel, NIVELES.REQUIERE_ATENCION);
  assert.equal(r.modalidad, 'cientifico');
});

test('baremo dinámico: ventana, mínimo de registros y reproducibilidad por fecha', () => {
  const dia = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
  const historial = Array.from({ length: 40 }, (_, i) => ({ valor: 280 + (i % 5) * 10, fecha: dia(i) })); // 280..320
  const params = { ventana_dias: 30, minimo_registros: 20 };

  const alDia39 = calcularParametrosDinamicos(historial, params, dia(39));
  assert.equal(alDia39.n, 30); // solo los últimos 30 días
  assert.equal(alDia39.suficiente, true);

  const alDia10 = calcularParametrosDinamicos(historial, params, dia(10)); // el futuro no cuenta
  assert.equal(alDia10.n, 11);
  assert.equal(alDia10.suficiente, false);

  const e = crearEstrategia({ modalidad: 'dinamico', parametros: params });
  assert.equal(e.clasificar(300, { historial, fecha: dia(10) }).nivel, null);
  assert.equal(e.clasificar(300, { historial, fecha: dia(10) }).motivo, 'datos_insuficientes');
  const ok = e.clasificar(300, { historial, fecha: dia(39) });
  assert.equal(ok.nivel, NIVELES.ACEPTABLE);
  assert.equal(ok.muestra.n, 30);
  assert.equal(e.clasificar(900, { historial, fecha: dia(39) }).nivel, NIVELES.REQUIERE_ATENCION);
  // serie constante (σ = 0): no se puede clasificar
  const plano = Array.from({ length: 30 }, (_, i) => ({ valor: 300, fecha: dia(i) }));
  assert.equal(e.clasificar(300, { historial: plano, fecha: dia(29) }).nivel, null);
  // basura en el historial se ignora
  const sucio = [...historial, { valor: 'x', fecha: dia(5) }, { valor: 5, fecha: 'no-fecha' }, null];
  assert.equal(calcularParametrosDinamicos(sucio, params, dia(39)).n, 30);
});

test('seleccionarBaremoVigente: dueño por modalidad, prueba y vigencia', () => {
  const filas = [
    { id: 'i1', empresa_id: 'E', prueba_id: null, modalidad: 'institucional', vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: '2026-05-01T00:00:00Z' },
    { id: 'i2', empresa_id: 'E', prueba_id: null, modalidad: 'institucional', vigente_desde: '2026-05-01T00:00:00Z', vigente_hasta: null },
    { id: 'i3', empresa_id: 'OTRA', prueba_id: null, modalidad: 'institucional', vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: null },
    { id: 'p1', empresa_id: 'E', prueba_id: 'P', modalidad: 'institucional', vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: null },
    { id: 'c1', empresa_id: null, prueba_id: null, modalidad: 'cientifico', vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: null },
  ];
  const sel = (extra) => seleccionarBaremoVigente(filas, { empresaId: 'E', fecha: '2026-06-01T00:00:00Z', ...extra }).id;
  assert.equal(sel({ modalidad: 'institucional' }), 'i2');
  assert.equal(seleccionarBaremoVigente(filas, { empresaId: 'E', modalidad: 'institucional', fecha: '2026-02-01T00:00:00Z' }).id, 'i1');
  assert.equal(sel({ modalidad: 'institucional', pruebaId: 'P' }), 'p1');
  assert.equal(sel({ modalidad: 'cientifico' }), 'c1');
  assert.equal(seleccionarBaremoVigente(filas, { empresaId: 'CUALQUIERA', modalidad: 'cientifico' }).id, 'c1');
  assert.throws(() => sel({ modalidad: 'dinamico' }), codigo('configuracion_no_encontrada'));
  assert.throws(() => sel({ modalidad: 'institucional', pruebaId: 'NO' }), codigo('configuracion_no_encontrada'));
});

// --------------------------- ScientificService -----------------------------

const FILA_ICO = { id: 'cfg-1', empresa_id: 'E', cargo_id: null, pesos: { reaccion: 60, memoria: 40 }, vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: null };
const crearServicio = ({ modalidad = 'institucional', baremos, historial = [] } = {}) =>
  new ScientificService({
    ico: { listar: async () => [FILA_ICO] },
    baremos: { listar: async () => baremos ?? [{ id: 'bar-1', empresa_id: 'E', prueba_id: null, modalidad: 'institucional', parametros: { umbrales: { excelente: 80, atencion: 60 } }, vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: null }] },
    obtenerModalidad: async () => modalidad,
    obtenerHistorialIco: async () => historial,
  });

test('calcularPuntajes normaliza y rechaza pruebas repetidas', () => {
  const s = crearServicio();
  const puntajes = s.calcularPuntajes([
    { prueba: 'reaccion', funcionPuntuacion: F.LINEAL_MENOR_MEJOR, crudo: 250, parametros: { mejor: 150, peor: 450 } },
    { prueba: 'memoria', funcionPuntuacion: F.LINEAL_MAYOR_MEJOR, crudo: 6, parametros: { minimo: 0, maximo: 10 } },
  ]);
  assert.deepEqual(puntajes, { reaccion: 66.67, memoria: 60 });
  assert.throws(() => s.calcularPuntajes([{ prueba: 'a', funcionPuntuacion: F.LINEAL_MAYOR_MEJOR, crudo: 1, parametros: { minimo: 0, maximo: 2 } }, { prueba: 'a', funcionPuntuacion: F.LINEAL_MAYOR_MEJOR, crudo: 1, parametros: { minimo: 0, maximo: 2 } }]), ScientificError);
});

test('evaluar: ICO + baremo institucional (el ICO se interpreta mayor_mejor) y trazabilidad', async () => {
  const r = await crearServicio().evaluar({ empresaId: 'E', fecha: '2026-03-01T00:00:00Z', puntajes: { reaccion: 90, memoria: 70 } });
  assert.equal(r.ico.valor, 82);
  assert.equal(r.clasificacion.nivel, NIVELES.EXCELENTE); // 82 > 80
  assert.equal(r.icoConfiguracionId, 'cfg-1');
  assert.equal(r.baremoId, 'bar-1');
  const bajo = await crearServicio().evaluar({ empresaId: 'E', fecha: '2026-03-01T00:00:00Z', puntajes: { reaccion: 50, memoria: 50 } });
  assert.equal(bajo.clasificacion.nivel, NIVELES.REQUIERE_ATENCION);
});

test('evaluar: ICO incompleto no se clasifica ni consulta baremos', async () => {
  let consultoBaremos = false;
  const s = new ScientificService({
    ico: { listar: async () => [FILA_ICO] },
    baremos: { listar: async () => { consultoBaremos = true; return []; } },
    obtenerModalidad: async () => 'institucional',
  });
  const r = await s.evaluar({ empresaId: 'E', fecha: '2026-03-01T00:00:00Z', puntajes: { reaccion: 90 } });
  assert.equal(r.ico.valor, null);
  assert.equal(r.clasificacion.nivel, null);
  assert.equal(r.clasificacion.motivo, 'cobertura_insuficiente');
  assert.equal(r.baremoId, null);
  assert.equal(consultoBaremos, false);
});

test('evaluar: baremo dinámico usa el historial aportado; sin datos suficientes no clasifica', async () => {
  const base = { id: 'bar-d', empresa_id: 'E', prueba_id: null, modalidad: 'dinamico', parametros: { ventana_dias: 90, minimo_registros: 5 }, vigente_desde: '2026-01-01T00:00:00Z', vigente_hasta: null };
  const historial = [60, 65, 70, 75, 80, 70, 72].map((valor, i) => ({ valor, fecha: new Date(Date.UTC(2026, 1, 1 + i)).toISOString() }));
  const con = await crearServicio({ modalidad: 'dinamico', baremos: [base], historial }).evaluar({ empresaId: 'E', fecha: '2026-03-01T00:00:00Z', puntajes: { reaccion: 95, memoria: 95 } });
  assert.equal(con.clasificacion.nivel, NIVELES.EXCELENTE);
  const sin = await crearServicio({ modalidad: 'dinamico', baremos: [base], historial: [] }).evaluar({ empresaId: 'E', fecha: '2026-03-01T00:00:00Z', puntajes: { reaccion: 95, memoria: 95 } });
  assert.equal(sin.clasificacion.nivel, null);
  assert.equal(sin.clasificacion.motivo, 'datos_insuficientes');
});

test('evaluar: sin baremo de la modalidad activa falla de forma explícita', async () => {
  await assert.rejects(
    crearServicio({ modalidad: 'cientifico' }).evaluar({ empresaId: 'E', fecha: '2026-03-01T00:00:00Z', puntajes: { reaccion: 90, memoria: 70 } }),
    codigo('configuracion_no_encontrada'),
  );
});

test('ConfiguracionCientificaService valida antes de publicar', async () => {
  const llamadas = [];
  const s = new ConfiguracionCientificaService({
    ico: { publicar: async (d) => (llamadas.push(['ico', d]), 'id-ico') },
    baremos: { publicar: async (d) => (llamadas.push(['baremo', d]), 'id-bar') },
  });
  assert.equal(await s.publicarPesos({ empresaId: 'E', pesos: { a: 1 } }), 'id-ico');
  await assert.rejects(s.publicarPesos({ empresaId: 'E', pesos: { a: -1 } }), codigo('pesos_invalidos'));
  assert.equal(await s.publicarBaremo({ empresaId: 'E', modalidad: 'dinamico', parametros: { ventana_dias: 30, minimo_registros: 5 } }), 'id-bar');
  await assert.rejects(s.publicarBaremo({ empresaId: 'E', modalidad: 'dinamico', parametros: {} }), codigo('baremo_invalido'));
  await assert.rejects(s.publicarBaremo({ empresaId: null, modalidad: 'cientifico', parametros: { media: 1, desviacion: 1 } }), codigo('baremo_invalido'));
  assert.equal(await s.publicarBaremo({ empresaId: null, modalidad: 'cientifico', parametros: { media: 1, desviacion: 1 }, fuente: 'Cita' }), 'id-bar');
  assert.equal(llamadas.length, 3);
});

test('repositorios: UUID obligatorio antes de interpolar filtros', async () => {
  const cliente = { from() { throw new Error('no debe consultar'); }, rpc() { throw new Error('no debe llamar'); } };
  const baremos = new BaremosRepository(cliente);
  const ico = new IcoConfiguracionesRepository(cliente);
  await assert.rejects(baremos.listar('x,empresa_id.is.null'), TypeError);
  await assert.rejects(ico.listar('no-uuid'), TypeError);
  await assert.rejects(ico.publicar({ empresaId: 'c1000000-0000-4000-8000-00000000000a', cargoId: 'mal', pesos: { a: 1 } }), TypeError);
});
