import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aCsv, celdaCsv, COLUMNAS_DATASET } from '../research/csv.js';
import { ResearchService, ResearchError } from '../research/research-service.js';

const EMP = 'c1000000-0000-4000-8000-00000000000a';
const COH = 'd1000000-0000-4000-8000-000000000009';
const pgError = (code, message) => Object.assign(new Error('rep'), { causaOriginal: { code, message } });

test('CSV: comillas, saltos de línea y BOM', () => {
  assert.equal(celdaCsv('a,b'), '"a,b"');
  assert.equal(celdaCsv('di "hola"'), '"di ""hola"""');
  assert.equal(celdaCsv('l1\nl2'), '"l1\nl2"');
  assert.equal(celdaCsv(null), '');
  assert.equal(celdaCsv(true), 'true');
  const csv = aCsv([{ a: 1, b: 'x' }], ['a', 'b']);
  assert.equal(csv, '﻿a,b\r\n1,x\r\n');
  assert.equal(aCsv([], ['a'], { bom: false }), 'a\r\n');
});

test('CSV: neutraliza inyección de fórmulas en texto pero respeta números negativos', () => {
  for (const peligro of ['=1+1', '+SUMA(A1)', '-2+3', '@cmd', '\tcmd']) assert.ok(celdaCsv(peligro).replace(/^"/, '').startsWith("'"), peligro);
  assert.equal(celdaCsv(-3.5), '-3.5');
  assert.equal(celdaCsv('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
});

test('crearCohorte valida nombre y criterio', async () => {
  const llamadas = [];
  const s = new ResearchService({ research: { crearCohorte: async (d) => { llamadas.push(d); return { id: COH }; } } });
  await assert.rejects(() => s.crearCohorte({ empresaId: EMP, nombre: '  ' }), ResearchError);
  await assert.rejects(() => s.crearCohorte({ empresaId: EMP, nombre: 'x'.repeat(121) }), ResearchError);
  await assert.rejects(() => s.crearCohorte({ empresaId: EMP, nombre: 'ok', areaId: 'no-uuid' }), ResearchError);
  await s.crearCohorte({ empresaId: EMP, nombre: '  Turno   noche ', areaId: COH });
  assert.deepEqual(llamadas[0], { empresaId: EMP, nombre: 'Turno noche', criterio: { area_id: COH } });
  await s.crearCohorte({ empresaId: EMP, nombre: 'Todos' });
  assert.equal(llamadas[1].criterio, null);
});

test('exportarCsv arma el archivo y traduce el error del mínimo de participantes', async () => {
  const filas = [{ participante: 'abc', fecha: '2026-10-15', turno: 'Diurno', prueba: 'reaccion_simple', intento: 1, valido_para_analisis: true, tiempo_total_ms: 300, errores_totales: 0, puntaje_normalizado: 80, ico_valor: 70, ico_nivel: 'aceptable' }];
  const s = new ResearchService({ research: { exportarDataset: async () => ({ dataset_id: 'abcdef12-0000-4000-8000-000000000000', participantes: 5, filas }) }, ahora: () => new Date('2026-10-15T12:00:00Z') });
  const r = await s.exportarCsv({ empresaId: EMP, cohorteId: COH });
  assert.equal(r.nombreArchivo, 'neurolab-dataset-2026-10-15-abcdef12.csv');
  assert.equal(r.filas, 1);
  assert.ok(r.csv.startsWith(`﻿${COLUMNAS_DATASET.join(',')}\r\n`));
  assert.ok(!r.csv.includes('cedula'));
  await assert.rejects(() => s.exportarCsv({ empresaId: EMP, cohorteId: COH, desde: '2026-10-10', hasta: '2026-10-01' }), ResearchError);

  const chico = new ResearchService({ research: { exportarDataset: async () => { throw pgError('23514', 'el mínimo para anonimizar es 5'); } } });
  await assert.rejects(() => chico.exportarCsv({ empresaId: EMP, cohorteId: COH }), (e) => e instanceof ResearchError && /mínimo de 5/.test(e.message) && e.codigo === 'validacion');
  const otro = new ResearchService({ research: { exportarDataset: async () => { throw pgError('42501', 'x'); } } });
  await assert.rejects(() => otro.exportarCsv({ empresaId: EMP, cohorteId: COH }), (e) => !(e instanceof ResearchError));
});

test('consentimiento: el documento debe ser https', async () => {
  const s = new ResearchService({ research: { registrarConsentimiento: async () => {} } });
  await assert.rejects(() => Promise.resolve().then(() => s.registrarConsentimiento({ empresaId: EMP, operadorId: COH, otorgado: true, documentoUrl: 'javascript:alert(1)' })), ResearchError);
  await s.registrarConsentimiento({ empresaId: EMP, operadorId: COH, otorgado: true, documentoUrl: 'https://docs.example.co/c.pdf' });
  await s.registrarConsentimiento({ empresaId: EMP, operadorId: COH, otorgado: false, documentoUrl: '' });
});
