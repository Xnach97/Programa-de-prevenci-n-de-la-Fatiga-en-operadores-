/**
 * @module tests/reaction
 * @description Tiempo de reacción simple (legado "Prueba de tiempos de
 * reacción"). Lógica pura + ejecutor. Anticiparse al estímulo es un error.
 *
 * `tiempo_total_ms` = tiempo de reacción MEDIO de los ensayos válidos (la
 * magnitud que el legado clasificaba); el detalle por ensayo va en `metricas`.
 */

import { testRegistry } from './test-registry.js';
import { ahoraMs } from './_comun.js';
import { h } from '../js/ui/dom.js';
import { t } from '../js/i18n.js';
import { mediana } from '../statistics/analytics.js';

export const CODIGO = 'reaccion_simple';

/**
 * @param {number} n Cantidad de ensayos.
 * @param {{min?: number, max?: number}} espera Rango de espera previa al estímulo (ms).
 * @param {() => number} rng
 * @returns {number[]}
 */
export function generarEsperas(n, { min = 1500, max = 4500 } = {}, rng = Math.random) {
  if (!Number.isInteger(n) || n < 1 || !(max >= min)) throw new RangeError('n ≥ 1 y max ≥ min.');
  return Array.from({ length: n }, () => Math.round(min + rng() * (max - min)));
}

/**
 * @param {Array<{ms: number|null, anticipo: boolean}>} ensayos
 */
export function resumirReaccion(ensayos) {
  const validos = ensayos.filter((e) => !e.anticipo && e.ms !== null).map((e) => e.ms);
  const anticipos = ensayos.filter((e) => e.anticipo).length;
  const media = validos.length ? Math.round(validos.reduce((a, b) => a + b, 0) / validos.length) : null;
  return {
    tiempo_total_ms: media, // null si no hubo ningún ensayo válido
    errores_totales: anticipos,
    metricas: {
      ensayos: ensayos.length,
      validos: validos.length,
      anticipos,
      media_ms: media,
      mediana_ms: validos.length ? Math.round(mediana(validos)) : null,
      minimo_ms: validos.length ? Math.min(...validos) : null,
      maximo_ms: validos.length ? Math.max(...validos) : null,
      tiempos_ms: validos,
    },
  };
}

/** Sin ensayos válidos el tiempo se toma como el peor posible (puntaje de tiempo 0). */
export function crudoReaccion(resultado, _funcion, parametros = {}) {
  return { tiempo_ms: resultado.tiempo_total_ms ?? parametros.tiempo_peor_ms ?? 0, errores: resultado.errores_totales };
}

/**
 * @param {HTMLElement} contenedor
 * @param {{parametros?: object, rng?: () => number}} [opciones]
 */
export function ejecutarReaccion(contenedor, { parametros = {}, rng = Math.random } = {}) {
  return new Promise((resolver) => {
    const esperas = generarEsperas(parametros.ensayos ?? 10, { min: parametros.espera_min_ms, max: parametros.espera_max_ms }, rng);
    const ensayos = [];
    let estimuloEn = null;
    let temporizador = null;
    let listo = false;

    const area = h('button', { type: 'button', class: 'reaction-area', 'aria-describedby': 'reaction-msg' });
    const mensaje = h('p', { id: 'reaction-msg', class: 'test-feedback', role: 'status', 'aria-live': 'assertive' });
    const progreso = h('span', { class: 'test-progress' });

    contenedor.replaceChildren(
      h('section', { class: 'test-panel' }, h('h2', {}, t('testing.reaccion.titulo')), progreso, area, mensaje),
    );

    const preparar = (estado, texto) => {
      area.dataset.estado = estado;
      area.textContent = texto;
      mensaje.textContent = texto;
    };

    const siguiente = () => {
      if (ensayos.length >= esperas.length) {
        area.disabled = true;
        resolver(resumirReaccion(ensayos));
        return;
      }
      progreso.textContent = `${ensayos.length + 1}/${esperas.length}`;
      listo = false;
      estimuloEn = null;
      preparar('espera', t('testing.reaccion.espera'));
      temporizador = setTimeout(() => {
        listo = true;
        estimuloEn = ahoraMs();
        preparar('ya', t('testing.reaccion.ya'));
      }, esperas[ensayos.length]);
    };

    area.addEventListener('pointerdown', (evento) => {
      evento.preventDefault();
      if (area.disabled) return;
      if (!listo) {
        clearTimeout(temporizador);
        ensayos.push({ ms: null, anticipo: true });
        preparar('error', t('testing.reaccion.anticipo'));
        setTimeout(siguiente, 1400);
        return;
      }
      const ms = Math.round(ahoraMs() - estimuloEn);
      listo = false;
      ensayos.push({ ms, anticipo: false });
      preparar('registrado', `${ms} ms`);
      setTimeout(siguiente, 900);
    });
    // Teclado: Enter/Espacio activan el botón → pointerdown no se dispara; se replica.
    area.addEventListener('keydown', (evento) => {
      if (evento.key === ' ' || evento.key === 'Enter') {
        evento.preventDefault();
        area.dispatchEvent(new Event('pointerdown'));
      }
    });

    setTimeout(siguiente, 800);
  });
}

testRegistry.register({
  codigo: CODIGO,
  categoria: 'velocidad',
  instrucciones: ['testing.reaccion.tutorial1', 'testing.reaccion.tutorial2'],
  ejecutar: ejecutarReaccion,
  crudo: crudoReaccion,
});
