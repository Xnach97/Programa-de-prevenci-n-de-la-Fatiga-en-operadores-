import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarCondicion, evaluarCondicion, resolverMensaje, percentilesRequeridos, formatearNumero, construirCondicion } from '../statistics/rules.js';
import { ReglasService, ReglasError } from '../services/reglas-service.js';
import { ConfiguracionService, ConfiguracionError, validarMarca, validarTurnos } from '../services/configuracion-service.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/condiciones.json', import.meta.url)));
const hoja = (indicador, op, valor) => ({ indicador, op, valor });
const ctx = (valores, percentiles = {}) => ({
  valor: (i) => valores[i],
  percentil: (i, p) => percentiles[`${i}:${p}`],
});

test('validación estructural: acepta las condiciones válidas y rechaza las inválidas', () => {
  for (const c of fixtures.validas) assert.equal(validarCondicion(c).valida, true, JSON.stringify(c));
  for (const c of fixtures.invalidas) assert.equal(validarCondicion(c).valida, false, JSON.stringify(c));
  const muchas = { and: Array.from({ length: 10 }, () => ({ or: [hoja('ico', '<', 1), hoja('ico', '<', 2), hoja('ico', '<', 3)] })) };
  assert.equal(validarCondicion(muchas).valida, false, 'más de 20 hojas');
});

test('evaluación: operadores y combinadores', () => {
  const v = ctx({ ico: 45, indice_fatiga: 70 });
  assert.equal(evaluarCondicion(hoja('ico', '<', 50), v).cumple, true);
  assert.equal(evaluarCondicion(hoja('ico', '<=', 45), v).cumple, true);
  assert.equal(evaluarCondicion(hoja('ico', '>', 45), v).cumple, false);
  assert.equal(evaluarCondicion(hoja('ico', '==', 45), v).cumple, true);
  assert.equal(evaluarCondicion(hoja('ico', '!=', 45), v).cumple, false);
  assert.equal(evaluarCondicion({ and: [hoja('ico', '<', 50), hoja('indice_fatiga', '>=', 60)] }, v).cumple, true);
  assert.equal(evaluarCondicion({ and: [hoja('ico', '<', 50), hoja('indice_fatiga', '>=', 90)] }, v).cumple, false);
  assert.equal(evaluarCondicion({ or: [hoja('ico', '>', 99), hoja('indice_fatiga', '>=', 60)] }, v).cumple, true);
  assert.equal(evaluarCondicion({ not: hoja('ico', '>', 99) }, v).cumple, true);
});

test('lógica de tres valores: un dato faltante nunca dispara (ni siquiera bajo "not")', () => {
  const v = ctx({ ico: 45 });
  assert.equal(evaluarCondicion(hoja('indice_fatiga', '>=', 60), v).cumple, false);
  assert.equal(evaluarCondicion({ not: hoja('indice_fatiga', '>=', 60) }, v).cumple, false);
  assert.equal(evaluarCondicion({ and: [hoja('ico', '<', 50), hoja('indice_fatiga', '>=', 60)] }, v).cumple, false);
  assert.equal(evaluarCondicion({ or: [hoja('ico', '<', 50), hoja('indice_fatiga', '>=', 60)] }, v).cumple, true);
  assert.equal(evaluarCondicion({ and: [hoja('ico', '>', 50), hoja('indice_fatiga', '>=', 60)] }, v).cumple, false);
  // valores no finitos cuentan como faltantes
  assert.equal(evaluarCondicion(hoja('ico', '<', 50), ctx({ ico: NaN })).cumple, false);
  assert.equal(evaluarCondicion(hoja('ico', '<', 50), ctx({ ico: null })).cumple, false);
});

test('percentil: compara contra el umbral histórico; sin histórico no dispara', () => {
  const c = { and: [{ indicador: 'reaccion_simple.tiempo', op: '>', percentil: 90 }, hoja('ico', '<', 70)] };
  const r = evaluarCondicion(c, ctx({ 'reaccion_simple.tiempo': 480, ico: 60 }, { 'reaccion_simple.tiempo:90': 450 }));
  assert.equal(r.cumple, true);
  assert.equal(r.hojas.find((h) => h.indicador === 'reaccion_simple.tiempo').referencia, 450);
  assert.equal(evaluarCondicion(c, ctx({ 'reaccion_simple.tiempo': 480, ico: 60 })).cumple, false);
  assert.deepEqual(percentilesRequeridos({ or: [c, { not: { indicador: 'ico', op: '<', percentil: 10 } }] }), [
    { indicador: 'reaccion_simple.tiempo', percentil: 90 },
    { indicador: 'ico', percentil: 10 },
  ]);
});

test('una condición inválida lanza error (no se evalúa parcialmente)', () => {
  assert.throws(() => evaluarCondicion({ indicador: 'x', op: '~', valor: 1 }, ctx({})), /inválida/);
});

test('mensajes: solo claves conocidas, sin expresiones, con recorte', () => {
  const datos = { operador: 'Ana', ico: '45', umbral: null };
  assert.equal(resolverMensaje('ICO de {operador}: {ico} < {umbral} {otro}', datos), 'ICO de Ana: 45 < {umbral} {otro}');
  assert.equal(resolverMensaje('{constructor} {__proto__} {toString}', datos), '{constructor} {__proto__} {toString}');
  assert.equal(resolverMensaje('${1+1} {operador.x}', datos), '${1+1} {operador.x}');
  assert.equal(resolverMensaje('x'.repeat(50), {}, 10).length, 10);
  assert.equal(formatearNumero(45.678), '45.7');
  assert.equal(formatearNumero(NaN), null);
});

// ---------------------------------------------------------------- servicio
const E = 'c1000000-0000-4000-8000-00000000000a';
const OP = 'b1000000-0000-4000-8000-000000000001';
const EV = 'e0000000-0000-4000-8000-000000000001';

function repoFalso({ reglas = [], plantillas = [], historico = [] } = {}) {
  const publicado = [];
  return {
    publicado,
    historicoPedido: [],
    listarReglas: async () => reglas,
    listarPlantillas: async () => plantillas,
    async historicoMetrica(o) { this.historicoPedido.push(o.indicador); return historico; },
    async publicarResultado(emp, alertas, recomendaciones) { publicado.push({ emp, alertas, recomendaciones }); return { alertas: alertas.length, recomendaciones: recomendaciones.length }; },
  };
}
const PAYLOAD = {
  evaluacion_id: EV, turno: 'Diurno', ico_valor: 45,
  resultados: [{ prueba_version_id: 'v4', tiempo_total_ms: 480, errores_totales: 1, puntaje_normalizado: 40 }],
};
const CODIGOS = { v4: 'reaccion_simple' };

test('servicio de reglas: alertas con severidad de la regla, mensaje resuelto y umbral de la hoja disparadora', async () => {
  const repo = repoFalso({
    reglas: [
      { id: 'r1', condicion: hoja('ico', '<', 50), severidad: 'roja', mensaje_plantilla: 'ICO de {operador} en {ico}, por debajo de {umbral} (turno {turno}).' },
      { id: 'r2', condicion: hoja('ico', '>', 90), severidad: 'info', mensaje_plantilla: 'no debe disparar' },
      { id: 'r3', condicion: { indicador: 'x', op: '~', valor: 1 }, severidad: 'info', mensaje_plantilla: 'condición corrupta: se ignora' },
    ],
    plantillas: [{ id: 'p1', condicion_activacion: hoja('indice_fatiga', '>=', 60), texto: 'Pausa para {operador}' }],
  });
  const r = await new ReglasService({ reglas: repo }).evaluarTrasEvaluacion({
    empresaId: E, operadorId: OP, operadorNombre: 'Ana Pérez', payload: PAYLOAD, codigosPorVersion: CODIGOS, indicadoresDia: { indice_fatiga: 72 },
  });
  assert.deepEqual(r, { alertas: 1, recomendaciones: 1 });
  const { alertas, recomendaciones } = repo.publicado[0];
  assert.equal(alertas[0].regla_id, 'r1');
  assert.equal(alertas[0].severidad, 'roja');
  assert.equal(alertas[0].mensaje, 'ICO de Ana Pérez en 45, por debajo de 50 (turno Diurno).');
  assert.equal(alertas[0].evaluacion_id, EV);
  assert.equal(recomendaciones[0].texto, 'Pausa para Ana Pérez');
});

test('servicio de reglas: percentiles con histórico suficiente; insuficiente no dispara; solo consulta lo necesario', async () => {
  const regla = { id: 'r1', condicion: { indicador: 'reaccion_simple.tiempo', op: '>', percentil: 90 }, severidad: 'naranja', mensaje_plantilla: 'lento ({umbral})' };
  const suficiente = repoFalso({ reglas: [regla], historico: Array.from({ length: 20 }, (_, i) => 200 + i * 10) });
  await new ReglasService({ reglas: suficiente }).evaluarTrasEvaluacion({ empresaId: E, operadorId: OP, payload: PAYLOAD, codigosPorVersion: CODIGOS });
  assert.equal(suficiente.publicado[0].alertas.length, 1);
  assert.deepEqual(suficiente.historicoPedido, ['reaccion_simple.tiempo']);

  const escaso = repoFalso({ reglas: [regla], historico: [300, 310, 320] });
  const r = await new ReglasService({ reglas: escaso }).evaluarTrasEvaluacion({ empresaId: E, operadorId: OP, payload: PAYLOAD, codigosPorVersion: CODIGOS });
  assert.deepEqual(r, { alertas: 0, recomendaciones: 0 });

  const sinPercentiles = repoFalso({ reglas: [{ ...regla, condicion: hoja('ico', '<', 50) }] });
  await new ReglasService({ reglas: sinPercentiles }).evaluarTrasEvaluacion({ empresaId: E, operadorId: OP, payload: PAYLOAD, codigosPorVersion: CODIGOS });
  assert.deepEqual(sinPercentiles.historicoPedido, [], 'sin hojas de percentil no se lee el histórico');
});

test('servicio de reglas: sin reglas ni plantillas no consulta ni publica; sin nombre usa "el operador"', async () => {
  const vacio = repoFalso();
  assert.deepEqual(await new ReglasService({ reglas: vacio }).evaluarTrasEvaluacion({ empresaId: E, operadorId: OP, payload: PAYLOAD, codigosPorVersion: CODIGOS }), { alertas: 0, recomendaciones: 0 });
  assert.equal(vacio.publicado.length, 0);
  const repo = repoFalso({ reglas: [{ id: 'r1', condicion: hoja('ico', '<', 50), severidad: 'info', mensaje_plantilla: 'Revisar a {operador}' }] });
  await new ReglasService({ reglas: repo }).evaluarTrasEvaluacion({ empresaId: E, operadorId: OP, operadorNombre: null, payload: PAYLOAD, codigosPorVersion: CODIGOS });
  assert.equal(repo.publicado[0].alertas[0].mensaje, 'Revisar a el operador');
});

test('administración de reglas: valida antes de enviar', async () => {
  const creadas = [];
  const servicio = new ReglasService({ reglas: { crearRegla: async (r) => { creadas.push(r); return { id: 'x' }; }, cambiarEstadoRegla: async () => ({}), resolverAlerta: async () => ({}) } });
  const base = { empresaId: E, nombre: ' Fatiga ', condicion: hoja('ico', '<', 50), severidad: 'roja', mensajePlantilla: 'Hola' };
  await servicio.crearRegla(base);
  assert.equal(creadas[0].nombre, 'Fatiga');
  for (const mala of [{ nombre: '' }, { severidad: 'morada' }, { mensajePlantilla: ' ' }, { condicion: { and: [] } }, { nombre: 'x'.repeat(121) }]) {
    await assert.rejects(() => servicio.crearRegla({ ...base, ...mala }), (e) => e instanceof ReglasError && e.codigo === 'validacion');
  }
  assert.throws(() => servicio.cambiarEstadoRegla('r', 'rara'), ReglasError);
  assert.throws(() => servicio.resolverAlerta('a', 'abierta'), ReglasError);
});

test('constructor de condiciones: una fila = hoja; varias = combinador', () => {
  const f = (indicador, op, tipo, numero) => ({ indicador, op, tipo, numero });
  assert.deepEqual(construirCondicion([f('ico', '<', 'valor', 50)], 'and'), hoja('ico', '<', 50));
  const c = construirCondicion([f('ico', '<', 'valor', 70), f('reaccion_simple.tiempo', '>', 'percentil', 90)], 'or');
  assert.deepEqual(c, { or: [hoja('ico', '<', 70), { indicador: 'reaccion_simple.tiempo', op: '>', percentil: 90 }] });
  assert.equal(validarCondicion(c).valida, true);
});

// ------------------------------------------------------------- configuración
test('marca: valida y normaliza; rechaza colores/URLs peligrosos', () => {
  assert.deepEqual(validarMarca({ color_primario: ' #FF0000 ', logo_url: 'https://cdn.x.co/a.png', color_acento: '' }), { color_primario: '#ff0000', logo_url: 'https://cdn.x.co/a.png' });
  for (const mala of [{ color_primario: 'red' }, { color_primario: 'red;background:url(x)' }, { logo_url: 'http://x.co/a.png' }, { logo_url: 'javascript:alert(1)' }, { logo_url: 'https://u:p@x.co/a' }]) {
    assert.throws(() => validarMarca(mala), ConfiguracionError, JSON.stringify(mala));
  }
});

test('turnos: horarios HH:MM, nombres únicos y máximo 6', () => {
  const t1 = { nombre: ' Diurno ', hora_inicio: '06:00', hora_fin: '18:00' };
  assert.deepEqual(validarTurnos([t1]), [{ ...t1, nombre: 'Diurno' }]);
  assert.deepEqual(validarTurnos([]), []);
  assert.throws(() => validarTurnos([t1, { ...t1, nombre: 'diurno' }]), /repetido/);
  assert.throws(() => validarTurnos([{ ...t1, hora_fin: '25:00' }]), /Horario/);
  assert.throws(() => validarTurnos([{ ...t1, nombre: '' }]), /nombre/);
  assert.throws(() => validarTurnos(Array.from({ length: 7 }, (_, i) => ({ ...t1, nombre: `T${i}` }))), /entre 0 y 6/);
});

function servicioConfig() {
  const llamadas = { general: [], pesos: [], baremos: [] };
  const servicio = new ConfiguracionService({
    empresas: { actualizarConfiguracion: async (...a) => { llamadas.general.push(a); return {}; } },
    cientifica: { publicarPesos: async (a) => { llamadas.pesos.push(a); }, publicarBaremo: async (a) => { llamadas.baremos.push(a); } },
    codigosPruebas: () => ['atencion_cancelacion', 'stroop_adaptado'],
  });
  return { servicio, llamadas };
}

test('configuración general: valida modalidad y pruebas; elimina duplicados', async () => {
  const { servicio, llamadas } = servicioConfig();
  const ok = { empresaId: E, usuarioId: OP, marca: {}, turnos: [], pruebasActivas: ['stroop_adaptado', 'stroop_adaptado'], baremoModalidad: 'institucional' };
  await servicio.guardarGeneral(ok);
  assert.deepEqual(llamadas.general[0][1].pruebas_activas, ['stroop_adaptado']);
  assert.equal(llamadas.general[0][2], OP);
  await assert.rejects(() => servicio.guardarGeneral({ ...ok, baremoModalidad: 'otro' }), ConfiguracionError);
  await assert.rejects(() => servicio.guardarGeneral({ ...ok, pruebasActivas: ['inventada'] }), ConfiguracionError);
});

test('pesos y baremo del ICO: dirección mayor_mejor, rangos y coherencia de umbrales', async () => {
  const { servicio, llamadas } = servicioConfig();
  await servicio.publicarPesos({ empresaId: E, pesos: { atencion_cancelacion: 1, stroop_adaptado: 2 } });
  await assert.rejects(() => servicio.publicarPesos({ empresaId: E, pesos: { inventada: 1 } }), ConfiguracionError);
  await servicio.publicarBaremoIco({ empresaId: E, modalidad: 'institucional', excelente: 75, atencion: 50 });
  assert.deepEqual(llamadas.baremos[0].parametros, { direccion: 'mayor_mejor', umbrales: { excelente: 75, atencion: 50 } });
  await assert.rejects(() => servicio.publicarBaremoIco({ empresaId: E, modalidad: 'institucional', excelente: 40, atencion: 50 }), /no puede ser menor/);
  await assert.rejects(() => servicio.publicarBaremoIco({ empresaId: E, modalidad: 'institucional', excelente: NaN, atencion: 50 }), ConfiguracionError);
  await assert.rejects(() => servicio.publicarBaremoIco({ empresaId: E, modalidad: 'institucional', excelente: 101, atencion: 50 }), ConfiguracionError);
  await servicio.publicarBaremoIco({ empresaId: E, modalidad: 'dinamico', ventanaDias: 90, minimoRegistros: 30 });
  assert.deepEqual(llamadas.baremos[1].parametros, { direccion: 'mayor_mejor', ventana_dias: 90, minimo_registros: 30 });
  await assert.rejects(() => servicio.publicarBaremoIco({ empresaId: E, modalidad: 'dinamico', ventanaDias: 0, minimoRegistros: 30 }), ConfiguracionError);
  await assert.rejects(() => servicio.publicarBaremoIco({ empresaId: E, modalidad: 'dinamico', ventanaDias: 90, minimoRegistros: 1 }), ConfiguracionError);
  await assert.rejects(() => servicio.publicarBaremoIco({ empresaId: E, modalidad: 'cientifico' }), /responsable científico/);
});
