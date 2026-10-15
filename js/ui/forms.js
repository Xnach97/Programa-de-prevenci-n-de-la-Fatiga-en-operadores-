/**
 * @module js/ui/forms
 * @description Componentes de formulario accesibles (etiqueta asociada, sin
 * `innerHTML`) y diálogo modal sobre `<dialog>` nativo (trampa de foco y Esc
 * gestionados por el navegador).
 */

import { h } from './dom.js';
import { t } from '../i18n.js';

let contadorId = 0;
const nuevoId = (prefijo) => `${prefijo}-${++contadorId}`;

/**
 * Campo con etiqueta explícita enlazada por `for`/`id`.
 * @param {string} etiqueta
 * @param {'input'|'select'} tag
 * @param {Record<string, unknown>} atributos
 * @param {Array<HTMLElement>} [hijos]
 * @returns {{contenedor: HTMLElement, control: HTMLInputElement|HTMLSelectElement}}
 */
export function campo(etiqueta, tag, atributos = {}, hijos = []) {
  const id = nuevoId('campo');
  const control = h(tag, { id, ...atributos }, hijos);
  const contenedor = h('div', { class: 'form-field' }, h('label', { for: id }, etiqueta), control);
  return { contenedor, control };
}

/**
 * `<option>`s a partir de filas {id, nombre}. Texto como nodo de texto (seguro).
 * @param {Array<{id: string, nombre: string, estado?: string}>} filas
 * @param {{vacio?: string, seleccionado?: string|null}} [opciones]
 * @returns {HTMLOptionElement[]}
 */
export function opcionesDeCatalogo(filas, { vacio = null, seleccionado = null } = {}) {
  const opciones = [];
  if (vacio !== null) opciones.push(h('option', { value: '' }, vacio));
  for (const fila of filas) {
    opciones.push(h('option', { value: fila.id, selected: fila.id === seleccionado }, fila.nombre));
  }
  return opciones;
}

/**
 * Abre un diálogo modal con formulario. `onEnviar` recibe el `<form>`; si
 * lanza, el mensaje se muestra dentro del diálogo y este permanece abierto.
 * @param {{
 *   titulo: string,
 *   descripcion?: string,
 *   contenido: Node[],
 *   textoConfirmar: string,
 *   peligro?: boolean,
 *   onEnviar: (formulario: HTMLFormElement) => Promise<void>,
 *   mensajeDeError: (error: unknown) => string,
 * }} opciones
 * @returns {Promise<boolean>} true si se confirmó con éxito, false si se canceló.
 */
export function abrirDialogo({ titulo, descripcion, contenido, textoConfirmar, peligro = false, onEnviar, mensajeDeError }) {
  return new Promise((resolve) => {
    const previo = document.activeElement;
    const idTitulo = nuevoId('dialogo-titulo');
    const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const botonConfirmar = h('button', { type: 'submit', class: peligro ? 'button-danger' : 'button-primary' }, textoConfirmar);
    const botonCancelar = h('button', { type: 'button', class: 'button-secondary' }, t('common.actions.cancel'));
    const formulario = h(
      'form',
      { novalidate: true },
      h('h2', { id: idTitulo }, titulo),
      descripcion ? h('p', { class: 'dialog__description' }, descripcion) : null,
      contenido,
      errorBox,
      h('div', { class: 'dialog__actions' }, botonCancelar, botonConfirmar),
    );
    const dialogo = h('dialog', { class: 'dialog', 'aria-labelledby': idTitulo }, formulario);

    let exito = false;
    const cerrar = () => dialogo.close();
    botonCancelar.addEventListener('click', cerrar);
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (previo instanceof HTMLElement && previo.isConnected) previo.focus();
      resolve(exito);
    });

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      errorBox.hidden = true;
      botonConfirmar.disabled = true;
      try {
        await onEnviar(formulario);
        exito = true;
        cerrar();
      } catch (error) {
        errorBox.textContent = mensajeDeError(error);
        errorBox.hidden = false;
        botonConfirmar.disabled = false;
      }
    });

    document.body.append(dialogo);
    dialogo.showModal();
  });
}

export default { campo, opcionesDeCatalogo, abrirDialogo };
