/**
 * @module dashboard/charts
 * @description Gráficas SVG sin dependencias (líneas, barras, radar e
 * histograma con curva gaussiana). Cada gráfica:
 *  - se construye con `createElementNS` (nunca `innerHTML`);
 *  - es `role="img"` con `aria-label`;
 *  - NO depende solo del color: líneas con trazos distintos, valores en tabla;
 *  - incluye una tabla de datos plegable (`<details>`) para lectores de pantalla.
 * Los colores salen de tokens CSS (`var(--color-*)`) vía clases.
 */

import { h } from '../js/ui/dom.js';
import { t } from '../js/i18n.js';
import { escalaLineal, ticksAgradables, segmentos, rutaLinea, puntosRadar, extremoEje, poligono, etiquetaDia } from './chart-math.js';

const NS = 'http://www.w3.org/2000/svg';
const ANCHO = 640;
const ALTO = 280;
const M = { arriba: 16, derecha: 16, abajo: 36, izquierda: 40 };

function el(nombre, atributos = {}, texto = null) {
  const nodo = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(atributos)) if (v !== null && v !== undefined) nodo.setAttribute(k, String(v));
  if (texto !== null) nodo.textContent = String(texto);
  return nodo;
}

function lienzo(ariaLabel, ancho = ANCHO, alto = ALTO) {
  return el('svg', { viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': ariaLabel, class: 'grafica__svg', preserveAspectRatio: 'xMidYMid meet' });
}

/** Envuelve el SVG con título y tabla de datos plegable. */
function marco({ titulo, svg, columnas, filas, leyenda = null }) {
  const tabla = h(
    'table',
    { class: 'table grafica__tabla' },
    h('thead', {}, h('tr', {}, columnas.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, filas.map((f) => h('tr', {}, f.map((c) => h('td', {}, c === null || c === undefined ? '—' : String(c)))))),
  );
  return h(
    'figure',
    { class: 'grafica' },
    h('figcaption', { class: 'grafica__titulo' }, titulo),
    svg,
    leyenda,
    h('details', { class: 'grafica__datos' }, h('summary', {}, t('dashboard.verDatos')), tabla),
  );
}

function ejeY(svg, escalaY, ticks, anchoUtil) {
  for (const tk of ticks) {
    const y = escalaY(tk);
    svg.append(el('line', { x1: M.izquierda, x2: M.izquierda + anchoUtil, y1: y, y2: y, class: 'grafica__rejilla' }));
    svg.append(el('text', { x: M.izquierda - 6, y: y + 4, class: 'grafica__etiqueta', 'text-anchor': 'end' }, tk));
  }
}

/**
 * Líneas sobre eje de días. Los `null` cortan la línea (no se interpolan).
 * @param {{titulo: string, aria: string, dias: string[], series: Array<{nombre: string, valores: Array<number|null>, estilo?: 'solida'|'punteada'}>, maximo?: number}} p
 */
export function graficaLineas({ titulo, aria, dias, series, maximo = 100 }) {
  const svg = lienzo(aria);
  const anchoUtil = ANCHO - M.izquierda - M.derecha;
  const altoUtil = ALTO - M.arriba - M.abajo;
  const escalaY = escalaLineal([0, maximo], [M.arriba + altoUtil, M.arriba]);
  const escalaX = escalaLineal([0, Math.max(dias.length - 1, 1)], [M.izquierda, M.izquierda + anchoUtil]);
  ejeY(svg, escalaY, ticksAgradables(0, maximo, 5), anchoUtil);
  const cada = Math.max(1, Math.ceil(dias.length / 8));
  dias.forEach((d, i) => {
    if (i % cada === 0) svg.append(el('text', { x: escalaX(i), y: ALTO - 14, class: 'grafica__etiqueta', 'text-anchor': 'middle' }, etiquetaDia(d)));
  });
  series.forEach((s, k) => {
    const puntos = s.valores.map((v, i) => ({ x: escalaX(i), y: v === null || v === undefined ? null : escalaY(v) }));
    for (const tramo of segmentos(puntos)) {
      svg.append(el('path', { d: rutaLinea(tramo), class: `grafica__linea grafica__linea--${k % 3} ${s.estilo === 'punteada' ? 'grafica__linea--punteada' : ''}`.trim(), fill: 'none' }));
    }
  });
  const leyenda = h('ul', { class: 'grafica__leyenda' }, series.map((s, k) => h('li', {}, h('span', { class: `grafica__muestra grafica__muestra--${k % 3} ${s.estilo === 'punteada' ? 'grafica__muestra--punteada' : ''}`.trim(), 'aria-hidden': 'true' }), s.nombre)));
  return marco({
    titulo,
    svg,
    leyenda,
    columnas: [t('dashboard.dia'), ...series.map((s) => s.nombre)],
    filas: dias.map((d, i) => [d, ...series.map((s) => (s.valores[i] === null || s.valores[i] === undefined ? null : Math.round(s.valores[i] * 10) / 10))]),
  });
}

/**
 * Barras horizontales (comparación entre áreas/cargos/operadores).
 * @param {{titulo: string, aria: string, items: Array<{etiqueta: string, valor: number|null}>, maximo?: number}} p
 */
export function graficaBarras({ titulo, aria, items, maximo = 100 }) {
  const fila = 26;
  const izq = 150;
  const alto = Math.max(items.length, 1) * fila + 28;
  const svg = lienzo(aria, ANCHO, alto);
  const escalaX = escalaLineal([0, maximo], [izq, ANCHO - 48]);
  items.forEach((it, i) => {
    const y = 8 + i * fila;
    svg.append(el('text', { x: izq - 8, y: y + 14, class: 'grafica__etiqueta', 'text-anchor': 'end' }, it.etiqueta.length > 22 ? `${it.etiqueta.slice(0, 21)}…` : it.etiqueta));
    if (it.valor !== null && it.valor !== undefined) {
      svg.append(el('rect', { x: izq, y, width: Math.max(escalaX(it.valor) - izq, 1), height: 18, class: 'grafica__barra', rx: 2 }));
      svg.append(el('text', { x: escalaX(it.valor) + 6, y: y + 14, class: 'grafica__valor' }, it.valor));
    }
  });
  return marco({ titulo, svg, columnas: [t('dashboard.grupo'), t('dashboard.valor')], filas: items.map((i) => [i.etiqueta, i.valor]) });
}

/**
 * Radar de varios ejes (0..maximo). Un eje sin dato se dibuja en el centro y se rotula "sin dato".
 * @param {{titulo: string, aria: string, ejes: Array<{etiqueta: string, valor: number|null}>, maximo?: number}} p
 */
export function graficaRadar({ titulo, aria, ejes, maximo = 100 }) {
  const lado = 300;
  const cx = lado / 2;
  const cy = lado / 2;
  const radio = 100;
  const svg = lienzo(aria, lado, lado);
  const n = ejes.length;
  for (const nivel of [0.25, 0.5, 0.75, 1]) {
    svg.append(el('polygon', { points: poligono(ejes.map((_, i) => extremoEje(i, n, cx, cy, radio * nivel))), class: 'grafica__rejilla', fill: 'none' }));
  }
  ejes.forEach((e, i) => {
    const fin = extremoEje(i, n, cx, cy, radio);
    svg.append(el('line', { x1: cx, y1: cy, x2: fin.x, y2: fin.y, class: 'grafica__rejilla' }));
    const lab = extremoEje(i, n, cx, cy, radio + 18);
    svg.append(el('text', { x: lab.x, y: lab.y + 4, class: 'grafica__etiqueta', 'text-anchor': Math.abs(lab.x - cx) < 4 ? 'middle' : lab.x > cx ? 'start' : 'end' }, `${e.etiqueta}${e.valor === null ? ` (${t('dashboard.sinDato')})` : ''}`));
  });
  svg.append(el('polygon', { points: poligono(puntosRadar(ejes.map((e) => e.valor), maximo, cx, cy, radio)), class: 'grafica__area' }));
  return marco({ titulo, svg, columnas: [t('dashboard.categoria'), t('dashboard.valor')], filas: ejes.map((e) => [e.etiqueta, e.valor === null ? null : Math.round(e.valor * 10) / 10]) });
}

/**
 * Histograma con curva gaussiana superpuesta (escalada a la altura de las barras).
 * @param {{titulo: string, aria: string, limites: number[], conteos: number[], curva: Array<{x: number, y: number}>}} p
 */
export function graficaHistograma({ titulo, aria, limites, conteos, curva }) {
  const svg = lienzo(aria);
  const anchoUtil = ANCHO - M.izquierda - M.derecha;
  const altoUtil = ALTO - M.arriba - M.abajo;
  const maxConteo = Math.max(...conteos, 1);
  const escalaX = escalaLineal([limites[0] ?? 0, limites[limites.length - 1] ?? 100], [M.izquierda, M.izquierda + anchoUtil]);
  const escalaY = escalaLineal([0, maxConteo], [M.arriba + altoUtil, M.arriba]);
  ejeY(svg, escalaY, ticksAgradables(0, maxConteo, Math.min(maxConteo, 5)), anchoUtil);
  conteos.forEach((c, i) => {
    const x0 = escalaX(limites[i]);
    const x1 = escalaX(limites[i + 1]);
    svg.append(el('rect', { x: x0 + 1, y: escalaY(c), width: Math.max(x1 - x0 - 2, 1), height: M.arriba + altoUtil - escalaY(c), class: 'grafica__barra' }));
    svg.append(el('text', { x: (x0 + x1) / 2, y: ALTO - 14, class: 'grafica__etiqueta', 'text-anchor': 'middle' }, Math.round(limites[i])));
  });
  const maxY = Math.max(...curva.map((p) => p.y), 0);
  if (curva.length > 1 && maxY > 0) {
    const escalaC = escalaLineal([0, maxY], [M.arriba + altoUtil, M.arriba]);
    svg.append(el('path', { d: rutaLinea(curva.map((p) => ({ x: escalaX(p.x), y: escalaC(p.y) }))), class: 'grafica__linea grafica__linea--1', fill: 'none' }));
  }
  return marco({
    titulo,
    svg,
    columnas: [t('dashboard.intervalo'), t('dashboard.cantidad')],
    filas: conteos.map((c, i) => [`${Math.round(limites[i])}–${Math.round(limites[i + 1])}`, c]),
  });
}

export default { graficaLineas, graficaBarras, graficaRadar, graficaHistograma };
