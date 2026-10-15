/**
 * @module tests/stroop
 * @description Stroop adaptado (legado "Prueba 2"): indicar el color de la
 * tinta de una palabra que nombra OTRO color. Lógica pura + ejecutor.
 */

import { testRegistry } from './test-registry.js';
import { entero, mezclar, ahoraMs, formatearTiempo } from './_comun.js';
import { h } from '../js/ui/dom.js';
import { t } from '../js/i18n.js';

export const CODIGO = 'stroop_adaptado';

/** Colores del legado. `hex` solo se usa para pintar la palabra. */
export const COLORES = Object.freeze([
  { nombre: 'rojo', palabra: 'ROJO', hex: '#E24B4A' },
  { nombre: 'azul', palabra: 'AZUL', hex: '#378ADD' },
  { nombre: 'verde', palabra: 'VERDE', hex: '#639922' },
  { nombre: 'naranja', palabra: 'NARANJA', hex: '#EF9F27' },
]);

/**
 * Ítems incongruentes: la palabra nunca coincide con el color de la tinta.
 * @param {number} n
 * @param {() => number} rng
 * @returns {Array<{palabra: string, color: string, hex: string}>}
 */
export function generarItems(n, rng = Math.random) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n debe ser un entero ≥ 1.');
  return Array.from({ length: n }, () => {
    const palabra = COLORES[entero(rng, COLORES.length)];
    let color;
    do color = COLORES[entero(rng, COLORES.length)];
    while (color.nombre === palabra.nombre);
    return { palabra: palabra.palabra, color: color.nombre, hex: color.hex };
  });
}

/** @returns {boolean} */
export const esRespuestaCorrecta = (respuesta, item) => respuesta === item.color;

/**
 * @param {Array<{correcta: boolean, ms: number}>} respuestas
 * @param {number} tiempoTotalMs
 */
export function resumirStroop(respuestas, tiempoTotalMs) {
  const errores = respuestas.filter((r) => !r.correcta).length;
  const tiempos = respuestas.map((r) => r.ms);
  return {
    tiempo_total_ms: Math.round(tiempoTotalMs),
    errores_totales: errores,
    metricas: {
      items: respuestas.length,
      aciertos: respuestas.length - errores,
      tiempo_medio_respuesta_ms: tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null,
    },
  };
}

export function crudoStroop(resultado) {
  return { tiempo_ms: resultado.tiempo_total_ms, errores: resultado.errores_totales };
}

/**
 * @param {HTMLElement} contenedor
 * @param {{parametros?: {items?: number, retardo_feedback_ms?: number}, rng?: () => number}} [opciones]
 */
export function ejecutarStroop(contenedor, { parametros = {}, rng = Math.random } = {}) {
  return new Promise((resolver) => {
    const items = generarItems(parametros.items ?? 12, rng);
    const retardo = parametros.retardo_feedback_ms ?? 650;
    const respuestas = [];
    const inicio = ahoraMs();
    let indice = 0;
    let mostradoEn = 0;

    const reloj = h('span', { class: 'test-timer', role: 'timer' }, '00:00');
    const intervalo = setInterval(() => {
      reloj.textContent = formatearTiempo(ahoraMs() - inicio);
    }, 500);
    const progreso = h('span', { class: 'test-progress' });
    const palabra = h('div', { class: 'stroop-word', 'aria-label': t('testing.stroop.palabraAria') });
    const opciones = h('div', { class: 'stroop-opts' });
    const feedback = h('div', { class: 'test-feedback', role: 'status', 'aria-live': 'polite' });

    contenedor.replaceChildren(
      h('section', { class: 'test-panel' }, h('h2', {}, t('testing.stroop.titulo')), h('p', {}, t('testing.stroop.consigna')), reloj, progreso, palabra, opciones, feedback),
    );

    const mostrar = () => {
      if (indice >= items.length) {
        clearInterval(intervalo);
        resolver(resumirStroop(respuestas, ahoraMs() - inicio));
        return;
      }
      const item = items[indice];
      palabra.textContent = item.palabra;
      palabra.style.color = item.hex;
      progreso.textContent = `${indice + 1}/${items.length}`;
      feedback.textContent = '';
      opciones.replaceChildren(
        ...mezclar(COLORES, rng).map((c) =>
          h(
            'button',
            {
              type: 'button',
              class: 'stroop-btn',
              on: {
                click: () => {
                  const correcta = esRespuestaCorrecta(c.nombre, item);
                  respuestas.push({ correcta, ms: ahoraMs() - mostradoEn });
                  feedback.textContent = correcta ? t('testing.stroop.correcto') : t('testing.stroop.incorrecto', { color: item.color });
                  feedback.dataset.ok = String(correcta);
                  for (const b of opciones.children) b.disabled = true; // evita doble respuesta durante el feedback
                  setTimeout(() => {
                    indice += 1;
                    mostrar();
                  }, retardo);
                },
              },
            },
            c.palabra.charAt(0) + c.palabra.slice(1).toLowerCase(),
          ),
        ),
      );
      mostradoEn = ahoraMs();
    };
    mostrar();
  });
}

testRegistry.register({
  codigo: CODIGO,
  categoria: 'inhibicion',
  instrucciones: ['testing.stroop.tutorial1', 'testing.stroop.tutorial2'],
  ejecutar: ejecutarStroop,
  crudo: crudoStroop,
});
