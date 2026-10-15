/**
 * @module tests/attention
 * @description Prueba de atención selectiva — cancelación de símbolos (legado
 * "Prueba 1"). Lógica pura + ejecutor de interfaz.
 *
 * Errores = clics en símbolos equivocados + objetivos omitidos (como el legado).
 */

import { testRegistry } from './test-registry.js';
import { entero, ahoraMs, formatearTiempo } from './_comun.js';
import { h } from '../js/ui/dom.js';
import { t } from '../js/i18n.js';

export const CODIGO = 'atencion_cancelacion';
const SIMBOLOS_POR_DEFECTO = ['★', '●', '▲', '■', '◆', '▼', '◀', '▶', '♦', '⬟'];

/**
 * Genera la cuadrícula: símbolos al azar, garantizando al menos
 * `minimoObjetivos` apariciones del símbolo objetivo.
 * @param {{celdas?: number, minimoObjetivos?: number, simbolos?: string[]}} parametros
 * @param {() => number} rng
 * @returns {{objetivo: string, celdas: string[]}}
 */
export function generarTablero({ celdas = 42, minimoObjetivos = 8, simbolos = SIMBOLOS_POR_DEFECTO } = {}, rng = Math.random) {
  if (minimoObjetivos > celdas) throw new RangeError('minimoObjetivos no puede superar el número de celdas.');
  const objetivo = simbolos[entero(rng, simbolos.length)];
  const pool = Array.from({ length: celdas }, () => simbolos[entero(rng, simbolos.length)]);
  let cuenta = pool.filter((s) => s === objetivo).length;
  while (cuenta < minimoObjetivos) {
    const p = entero(rng, celdas);
    if (pool[p] !== objetivo) {
      pool[p] = objetivo;
      cuenta += 1;
    }
  }
  return { objetivo, celdas: pool };
}

/**
 * @param {{celdas: string[], objetivo: string, marcadas: Set<number>|number[], clicsErroneos: number}} sesion
 * @returns {{objetivos: number, aciertos: number, omisiones: number, clicsErroneos: number, errores: number}}
 */
export function evaluarCancelacion({ celdas, objetivo, marcadas, clicsErroneos }) {
  const objetivos = celdas.filter((s) => s === objetivo).length;
  const aciertos = new Set(marcadas).size;
  const omisiones = objetivos - aciertos;
  return { objetivos, aciertos, omisiones, clicsErroneos, errores: clicsErroneos + omisiones };
}

/**
 * Resultado estándar de la prueba (tiempo + errores + métricas).
 * @returns {{tiempo_total_ms: number, errores_totales: number, metricas: object}}
 */
export function resumirAtencion(evaluacion, tiempoMs) {
  return {
    tiempo_total_ms: Math.round(tiempoMs),
    errores_totales: evaluacion.errores,
    metricas: {
      objetivos: evaluacion.objetivos,
      aciertos: evaluacion.aciertos,
      omisiones: evaluacion.omisiones,
      clics_erroneos: evaluacion.clicsErroneos,
    },
  };
}

/** Entrada de `puntuar()` para las funciones genéricas del Scientific Engine. */
export function crudoAtencion(resultado) {
  return { tiempo_ms: resultado.tiempo_total_ms, errores: resultado.errores_totales };
}

/**
 * Ejecutor de interfaz. Resuelve cuando el operador pulsa "Finalizar".
 * @param {HTMLElement} contenedor
 * @param {{parametros?: object, rng?: () => number}} [opciones]
 */
export function ejecutarAtencion(contenedor, { parametros = {}, rng = Math.random } = {}) {
  return new Promise((resolver) => {
    const { objetivo, celdas } = generarTablero(parametros, rng);
    const marcadas = new Set();
    let clicsErroneos = 0;
    const inicio = ahoraMs();

    const reloj = h('span', { class: 'test-timer', role: 'timer' }, '00:00');
    const intervalo = setInterval(() => {
      reloj.textContent = formatearTiempo(ahoraMs() - inicio);
    }, 500);

    const botones = celdas.map((simbolo, i) =>
      h(
        'button',
        {
          type: 'button',
          class: 'sym-btn',
          'aria-label': simbolo,
          on: {
            click: (evento) => {
              const boton = evento.currentTarget;
              if (boton.dataset.estado) return;
              if (simbolo === objetivo) {
                marcadas.add(i);
                boton.dataset.estado = 'acierto';
              } else {
                clicsErroneos += 1;
                boton.dataset.estado = 'error';
              }
              boton.setAttribute('aria-pressed', 'true');
            },
          },
        },
        simbolo,
      ),
    );

    const finalizar = h(
      'button',
      {
        type: 'button',
        class: 'button-primary',
        on: {
          click: () => {
            clearInterval(intervalo);
            const tiempo = ahoraMs() - inicio;
            resolver(resumirAtencion(evaluarCancelacion({ celdas, objetivo, marcadas, clicsErroneos }), tiempo));
          },
        },
      },
      t('testing.atencion.finalizar'),
    );

    contenedor.replaceChildren(
      h(
        'section',
        { class: 'test-panel' },
        h('h2', {}, t('testing.atencion.titulo')),
        h('p', { class: 'test-objetivo' }, t('testing.atencion.objetivo'), ' ', h('strong', { class: 'test-objetivo__simbolo', 'aria-label': objetivo }, objetivo)),
        reloj,
        h('div', { class: 'sym-grid' }, botones),
        finalizar,
      ),
    );
  });
}

testRegistry.register({
  codigo: CODIGO,
  categoria: 'atencion',
  instrucciones: ['testing.atencion.tutorial1', 'testing.atencion.tutorial2'],
  ejecutar: ejecutarAtencion,
  crudo: crudoAtencion,
});
