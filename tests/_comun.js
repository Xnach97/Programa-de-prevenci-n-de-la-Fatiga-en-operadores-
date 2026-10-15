/**
 * @module tests/_comun
 * @description Utilidades compartidas por las pruebas: generador aleatorio
 * inyectable (testeable) y cronómetro. Sin dependencias de DOM.
 */

/** @typedef {() => number} Rng  Devuelve un número en [0, 1). */

/** Entero aleatorio en [0, n). */
export const entero = (rng, n) => Math.floor(rng() * n);

/**
 * Generador pseudoaleatorio determinista (mulberry32) para pruebas y para
 * reproducir una sesión a partir de una semilla.
 * @param {number} semilla
 * @returns {Rng}
 */
export function crearRng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla Fisher–Yates (no muta la entrada). */
export function mezclar(lista, rng) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = entero(rng, i + 1);
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Reloj monotónico en ms (performance.now cuando existe). */
export const ahoraMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** "mm:ss" para un total de milisegundos. */
export function formatearTiempo(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default { entero, crearRng, mezclar, ahoraMs, formatearTiempo };
