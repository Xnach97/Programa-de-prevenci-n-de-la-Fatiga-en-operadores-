/**
 * @module tests/tutorial
 * @description Tutorial previo a cada prueba (Fase 2 §4: "una vez por prueba, la
 * primera vez que el operador la ve"). El "visto" se recuerda por dispositivo
 * en localStorage (comodidad; si no está disponible, simplemente se muestra).
 */

import { h } from '../js/ui/dom.js';
import { t } from '../js/i18n.js';

const clave = (operadorId, codigo) => `neurolab_sst:tutorial:${operadorId}:${codigo}`;

/** @returns {boolean} */
export function tutorialVisto(operadorId, codigo) {
  try {
    return globalThis.localStorage?.getItem(clave(operadorId, codigo)) === '1';
  } catch {
    return false;
  }
}

function marcarVisto(operadorId, codigo) {
  try {
    globalThis.localStorage?.setItem(clave(operadorId, codigo), '1');
  } catch {
    /* sin almacenamiento: se mostrará de nuevo, sin consecuencias */
  }
}

/**
 * Muestra el tutorial y resuelve al pulsar "Entendido". Si ya se vio, resuelve
 * de inmediato sin tocar el DOM.
 * @param {HTMLElement} contenedor
 * @param {{operadorId: string, codigo: string, titulo: string, pasos: string[]}} datos `pasos` = claves i18n.
 * @param {{siempre?: boolean}} [opciones] `siempre` ignora el "visto".
 * @returns {Promise<void>}
 */
export function mostrarTutorial(contenedor, { operadorId, codigo, titulo, pasos }, { siempre = false } = {}) {
  if (!siempre && tutorialVisto(operadorId, codigo)) return Promise.resolve();
  return new Promise((resolver) => {
    const boton = h(
      'button',
      {
        type: 'button',
        class: 'button-primary',
        on: {
          click: () => {
            marcarVisto(operadorId, codigo);
            resolver();
          },
        },
      },
      t('testing.tutorial.entendido'),
    );
    contenedor.replaceChildren(
      h(
        'section',
        { class: 'test-panel' },
        h('h2', {}, titulo),
        h('p', { class: 'test-tutorial__aviso' }, t('testing.tutorial.aviso')),
        h('ol', { class: 'test-tutorial__pasos' }, pasos.map((p) => h('li', {}, t(p)))),
        boton,
      ),
    );
    boton.focus();
  });
}

export default { mostrarTutorial, tutorialVisto };
