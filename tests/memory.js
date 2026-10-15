/**
 * @module tests/memory
 * @description Memoria de secuencias (legado "Prueba 3"). Rondas de longitud
 * creciente; tras un error la ronda se da por perdida y se pasa a la siguiente.
 *
 * Corrige el defecto del legado: `p3_nivel_max` se calculaba pero nunca se
 * guardaba. Aquí `nivel_max` y `rondas_correctas` viajan en `metricas`.
 */

import { testRegistry } from './test-registry.js';
import { entero, ahoraMs, formatearTiempo } from './_comun.js';
import { h } from '../js/ui/dom.js';
import { t } from '../js/i18n.js';

export const CODIGO = 'memoria_secuencias';
export const ELEMENTOS = Object.freeze([
  { emoji: '🔵', nombre: 'azul' },
  { emoji: '🟡', nombre: 'amarillo' },
  { emoji: '🟢', nombre: 'verde' },
  { emoji: '🔴', nombre: 'rojo' },
  { emoji: '🟣', nombre: 'morado' },
  { emoji: '🟠', nombre: 'naranja' },
]);

/**
 * Secuencias de longitud 1..rondas: sin repetir el mismo elemento
 * consecutivamente y, si es posible, sin empezar igual que la ronda anterior.
 * @param {number} rondas
 * @param {number} elementos Cantidad de celdas.
 * @param {() => number} rng
 * @returns {number[][]}
 */
export function generarSecuencias(rondas, elementos = 6, rng = Math.random) {
  if (!Number.isInteger(rondas) || rondas < 1 || !Number.isInteger(elementos) || elementos < 2) {
    throw new RangeError('rondas ≥ 1 y elementos ≥ 2.');
  }
  const secuencias = [];
  for (let r = 0; r < rondas; r += 1) {
    let seq;
    let intentos = 0;
    do {
      seq = [];
      for (let i = 0; i < r + 1; i += 1) {
        let v;
        do v = entero(rng, elementos);
        while (seq.length > 0 && v === seq[seq.length - 1]);
        seq.push(v);
      }
      intentos += 1;
    } while (intentos < 50 && secuencias.length > 0 && seq[0] === secuencias[secuencias.length - 1][0]);
    secuencias.push(seq);
  }
  return secuencias;
}

/**
 * Máquina de estados de la sesión (sin tiempos ni DOM).
 * @param {number[][]} secuencias
 */
export function crearSesionMemoria(secuencias) {
  let nivel = 0;
  let entrada = [];
  let errores = 0;
  let rondasCorrectas = 0;
  let nivelMax = 0;

  return {
    get nivel() { return nivel; },
    get terminada() { return nivel >= secuencias.length; },
    get secuenciaActual() { return secuencias[nivel] ?? null; },
    /**
     * @param {number} indice Celda pulsada.
     * @returns {{correcto: boolean, rondaCompleta: boolean, rondaPerdida: boolean}}
     */
    ingresar(indice) {
      if (this.terminada) throw new Error('La sesión ya terminó.');
      const seq = secuencias[nivel];
      const pos = entrada.length;
      entrada.push(indice);
      if (indice === seq[pos]) {
        if (entrada.length === seq.length) {
          rondasCorrectas += 1;
          nivelMax = Math.max(nivelMax, seq.length);
          nivel += 1;
          entrada = [];
          return { correcto: true, rondaCompleta: true, rondaPerdida: false };
        }
        return { correcto: true, rondaCompleta: false, rondaPerdida: false };
      }
      errores += 1;
      nivel += 1;
      entrada = [];
      return { correcto: false, rondaCompleta: false, rondaPerdida: true };
    },
    resumen() {
      return { rondas: secuencias.length, rondasCorrectas, nivelMax, errores };
    },
  };
}

export function resumirMemoria(resumen, tiempoMs) {
  return {
    tiempo_total_ms: Math.round(tiempoMs),
    errores_totales: resumen.errores,
    metricas: { rondas: resumen.rondas, rondas_correctas: resumen.rondasCorrectas, nivel_max: resumen.nivelMax },
  };
}

/** Las funciones `lineal_*` leen `valor`; el resto, tiempo y errores. */
export function crudoMemoria(resultado, funcionPuntuacion) {
  if (funcionPuntuacion?.startsWith('lineal_')) return { valor: resultado.metricas.rondas_correctas };
  return { tiempo_ms: resultado.tiempo_total_ms, errores: resultado.errores_totales };
}

/**
 * @param {HTMLElement} contenedor
 * @param {{parametros?: {rondas?: number, elementos?: number}, rng?: () => number}} [opciones]
 */
export function ejecutarMemoria(contenedor, { parametros = {}, rng = Math.random } = {}) {
  return new Promise((resolver) => {
    const rondas = parametros.rondas ?? 6;
    const sesion = crearSesionMemoria(generarSecuencias(rondas, ELEMENTOS.length, rng));
    const inicio = ahoraMs();
    let mostrando = true;

    const reloj = h('span', { class: 'test-timer', role: 'timer' }, '00:00');
    const intervalo = setInterval(() => {
      reloj.textContent = formatearTiempo(ahoraMs() - inicio);
    }, 500);
    const estado = h('p', { class: 'test-feedback', role: 'status', 'aria-live': 'polite' });
    const ronda = h('p', { class: 'test-progress' });
    const celdas = ELEMENTOS.map((el, i) =>
      h('button', { type: 'button', class: 'mem-cell', 'aria-label': el.nombre, on: { click: () => pulsar(i) } }, el.emoji),
    );

    contenedor.replaceChildren(
      h('section', { class: 'test-panel' }, h('h2', {}, t('testing.memoria.titulo')), reloj, ronda, estado, h('div', { class: 'mem-grid' }, celdas)),
    );

    const encender = (i, activo) => celdas[i].classList.toggle('activo', activo);

    const mostrarSecuencia = (seq, i = 0) => {
      if (i >= seq.length) {
        setTimeout(() => {
          mostrando = false;
          estado.textContent = t('testing.memoria.repite');
        }, 500);
        return;
      }
      setTimeout(() => {
        encender(seq[i], true);
        setTimeout(() => {
          encender(seq[i], false);
          mostrarSecuencia(seq, i + 1);
        }, 650);
      }, 450);
    };

    const nuevaRonda = () => {
      if (sesion.terminada) {
        clearInterval(intervalo);
        resolver(resumirMemoria(sesion.resumen(), ahoraMs() - inicio));
        return;
      }
      mostrando = true;
      const seq = sesion.secuenciaActual;
      estado.textContent = t('testing.memoria.observa');
      ronda.textContent = t('testing.memoria.ronda', { n: sesion.nivel + 1, largo: seq.length });
      mostrarSecuencia(seq);
    };

    function pulsar(i) {
      if (mostrando || sesion.terminada) return;
      const r = sesion.ingresar(i);
      celdas[i].dataset.estado = r.correcto ? 'ok' : 'error';
      setTimeout(() => delete celdas[i].dataset.estado, 450);
      if (r.rondaCompleta || r.rondaPerdida) {
        mostrando = true; // bloquea pulsaciones hasta la siguiente ronda
        setTimeout(nuevaRonda, r.rondaCompleta ? 700 : 600);
      }
    }

    setTimeout(nuevaRonda, 800);
  });
}

testRegistry.register({
  codigo: CODIGO,
  categoria: 'memoria',
  instrucciones: ['testing.memoria.tutorial1', 'testing.memoria.tutorial2'],
  ejecutar: ejecutarMemoria,
  crudo: crudoMemoria,
});
