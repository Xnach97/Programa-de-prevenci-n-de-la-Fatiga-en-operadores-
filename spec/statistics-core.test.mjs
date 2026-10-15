/**
 * @file spec/statistics-core.test.mjs
 * @description Pruebas del núcleo estadístico: analytics, percentiles, gaussian.
 * Valores de referencia verificados contra NumPy/SciPy y tablas normales.
 * Ejecutar: node --test spec/statistics-core.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../statistics/analytics.js';
import * as P from '../statistics/percentiles.js';
import * as G from '../statistics/gaussian.js';
import { ScientificError } from '../statistics/scientific-error.js';

const cerca = (real, esperado, tol = 1e-9) => assert.ok(Math.abs(real - esperado) <= tol, `${real} ≠ ${esperado} (±${tol})`);

test('media / varianza / desviación: muestral por defecto y poblacional explícita', () => {
  const v = [2, 4, 4, 4, 5, 5, 7, 9]; // ejemplo clásico: σ poblacional = 2
  cerca(A.media(v), 5);
  cerca(A.desviacionEstandar(v, { muestral: false }), 2);
  cerca(A.desviacionEstandar(v), Math.sqrt(32 / 7));
  assert.equal(A.media([]), null);
  assert.equal(A.desviacionEstandar([3]), null); // muestral exige n ≥ 2
  assert.equal(A.desviacionEstandar([3], { muestral: false }), 0);
});

test('los datos faltantes se descartan; los strings se rechazan', () => {
  cerca(A.media([1, null, undefined, NaN, 3, Infinity]), 2);
  assert.throws(() => A.media([1, '2']), ScientificError);
  assert.throws(() => A.media('no es arreglo'), ScientificError);
});

test('mediana y coeficiente de variación', () => {
  cerca(A.mediana([5, 1, 3]), 3);
  cerca(A.mediana([1, 2, 3, 4]), 2.5);
  cerca(A.coeficienteVariacion([10, 20, 30]), 10 / 20);
  assert.equal(A.coeficienteVariacion([-1, 1]), null); // media 0
});

test('zScore valida σ > 0', () => {
  cerca(A.zScore(130, 100, 15), 2);
  assert.throws(() => A.zScore(1, 0, 0), ScientificError);
  assert.throws(() => A.zScore(NaN, 0, 1), ScientificError);
});

test('variacionRelativa (regla de +20 % en tiempo de reacción)', () => {
  cerca(A.variacionRelativa(250, 300), 0.2);
  assert.equal(A.variacionRelativa(0, 5), null);
});

test('outliers: IQR y z devuelven índices sobre la serie original', () => {
  const serie = [10, 11, 12, null, 11, 10, 95];
  const iqr = A.detectarOutliers(serie);
  assert.deepEqual(iqr.indices, [6]);
  const z = A.detectarOutliers([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 50], { metodo: 'z', umbral: 2 });
  assert.deepEqual(z.indices, [10]);
  assert.deepEqual(A.detectarOutliers([5, 5, 5], { metodo: 'z' }).indices, []); // σ = 0
  assert.throws(() => A.detectarOutliers([1], { metodo: 'otro' }), ScientificError);
});

test('promedioMovil: ventana hacia atrás, null mientras no hay datos suficientes', () => {
  assert.deepEqual(A.promedioMovil([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.deepEqual(A.promedioMovil([1, null, 3, 4], 2), [null, null, null, 3.5]);
  assert.throws(() => A.promedioMovil([1], 0), ScientificError);
});

test('histograma: clases iguales, último intervalo cerrado, serie constante', () => {
  const h = A.histograma([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { clases: 5 });
  assert.deepEqual(h.conteos, [2, 2, 2, 2, 3]);
  assert.equal(h.conteos.reduce((a, b) => a + b, 0), 11);
  assert.deepEqual(A.histograma([]), { limites: [], conteos: [] });
  assert.equal(A.histograma([3, 3, 3], { clases: 2 }).conteos.reduce((a, b) => a + b, 0), 3);
});

test('resumenDescriptivo coincide con las funciones individuales', () => {
  const r = A.resumenDescriptivo([1, 2, 3, 4, 5]);
  assert.equal(r.n, 5);
  cerca(r.media, 3);
  cerca(r.mediana, 3);
  cerca(r.p25, 2);
  cerca(r.p75, 4);
  assert.equal(r.minimo, 1);
  assert.equal(r.maximo, 5);
  assert.equal(A.resumenDescriptivo([]).media, null);
});

test('percentil: interpolación lineal (método 7), igual a NumPy', () => {
  const v = [15, 20, 35, 40, 50];
  cerca(P.percentil(v, 0), 15);
  cerca(P.percentil(v, 25), 20);
  cerca(P.percentil(v, 40), 29); // posición 1.6 → 20 + 0.6·15
  cerca(P.percentil(v, 100), 50);
  cerca(P.percentil([7], 90), 7);
  assert.equal(P.percentil([], 50), null);
  assert.throws(() => P.percentil(v, 101), ScientificError);
  assert.throws(() => P.percentil(v, -1), ScientificError);
  assert.deepEqual(v, [15, 20, 35, 40, 50]); // no muta la entrada
});

test('percentiles múltiples y rangoPercentil', () => {
  const m = P.percentiles([1, 2, 3, 4, 5], [25, 50, 75, 90]);
  cerca(m[25], 2); cerca(m[50], 3); cerca(m[75], 4); cerca(m[90], 4.6);
  cerca(P.rangoPercentil([1, 2, 3, 4], 3), 62.5);
  cerca(P.rangoPercentil([1, 2, 3, 4], 0), 0);
  cerca(P.rangoPercentil([1, 2, 3, 4], 99), 100);
  assert.equal(P.rangoPercentil([], 1), null);
});

test('gaussPDF: valor máximo, simetría y σ degenerada (legado)', () => {
  cerca(G.gaussPDF(0, 0, 1), 1 / Math.sqrt(2 * Math.PI));
  cerca(G.gaussPDF(1, 0, 1), G.gaussPDF(-1, 0, 1));
  assert.equal(G.gaussPDF(5, 5, 0.001), 1);
  assert.equal(G.gaussPDF(6, 5, 0.001), 0);
  assert.throws(() => G.gaussPDF(0, 0, -1), ScientificError);
});

test('gaussCDF / erf: valores de tabla con precisión ~1e-12', () => {
  cerca(G.erf(0.5), 0.5204998778130465, 1e-12);
  cerca(G.gaussCDF(0), 0.5, 1e-15);
  cerca(G.gaussCDF(1), 0.8413447460685429, 1e-12);
  cerca(G.gaussCDF(-1), 0.15865525393145707, 1e-12);
  cerca(G.gaussCDF(1.96), 0.9750021048517795, 1e-12);
  cerca(G.gaussCDF(8), 1, 1e-15);
  cerca(G.gaussCDF(-8), 0, 1e-15);
  cerca(G.gaussCDF(130, 100, 15), G.gaussCDF(2), 1e-12);
  cerca(G.probabilidadEntre(-1, 1, 0, 1), 0.6826894921370859, 1e-12);
  assert.throws(() => G.gaussCDF(0, 0, 0), ScientificError);
  assert.throws(() => G.probabilidadEntre(2, 1, 0, 1), ScientificError);
});

test('construirCurva reproduce el legado: dominio, recorte en 0 y σ sustituta', () => {
  const c = G.construirCurva([100, 120, 140, 160, 180]);
  assert.equal(c.puntos.length, 101);
  cerca(c.media, 140);
  cerca(c.desviacion, Math.sqrt(1000));
  assert.ok(c.puntos[0].x >= 0);
  const max = c.puntos.reduce((a, b) => (b.y > a.y ? b : a));
  cerca(max.x, 140, 1);
  const unico = G.construirCurva([50]);
  assert.equal(unico.desviacion, 1); // un solo dato → σ = 1
  const cercanos = G.construirCurva([5, 5.1]);
  assert.equal(cercanos.desviacion, 1); // σ < 0.3 → σ = 1
  assert.deepEqual(G.construirCurva([]).puntos, []);
  const sinRecorte = G.construirCurva([1, 2, 3], { dominioMinimo: -Infinity });
  assert.ok(sinRecorte.puntos[0].x < 0);
});
