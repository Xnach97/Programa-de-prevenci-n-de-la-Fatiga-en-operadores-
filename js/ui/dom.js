/**
 * @module js/ui/dom
 * @description Constructor de DOM seguro (hiperscript mínimo).
 *
 * Existe para que ningún dato de la base de datos llegue jamás a `innerHTML`:
 * el texto se inserta como nodos de texto y los atributos con `setAttribute`
 * tras una lista de exclusión (sin `on*` en atributos, sin `style`, sin
 * `innerHTML`/`srcdoc`). Los manejadores de eventos se pasan en `on`.
 */

const ATRIBUTOS_PROHIBIDOS = /^(on|style$|innerhtml$|outerhtml$|srcdoc$)/i;
const ATRIBUTOS_URL = /^(href|src|action|formaction|xlink:href)$/i;

/**
 * @param {string} tag
 * @param {{
 *   class?: string,
 *   dataset?: Record<string,string>,
 *   on?: Record<string, EventListener>,
 *   [atributo: string]: unknown
 * }} [props]
 * @param {...(Node|string|number|null|undefined|false|Array<any>)} hijos
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...hijos) {
  const elemento = document.createElement(tag);

  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'class') {
      elemento.className = String(valor);
    } else if (clave === 'dataset') {
      for (const [k, v] of Object.entries(valor)) elemento.dataset[k] = String(v);
    } else if (clave === 'on') {
      for (const [evento, manejador] of Object.entries(valor)) elemento.addEventListener(evento, manejador);
    } else if (ATRIBUTOS_PROHIBIDOS.test(clave)) {
      throw new Error(`Atributo no permitido en h(): ${clave}`);
    } else if (ATRIBUTOS_URL.test(clave) && !/^(#|\/(?!\/))/.test(String(valor))) {
      throw new Error(`URL no permitida en h(): solo rutas relativas o hash (${clave}).`);
    } else if (valor === true) {
      elemento.setAttribute(clave, '');
    } else if (clave === 'value') {
      elemento.value = String(valor);
    } else {
      elemento.setAttribute(clave, String(valor));
    }
  }

  anadirHijos(elemento, hijos);
  return elemento;
}

function anadirHijos(padre, hijos) {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    if (Array.isArray(hijo)) anadirHijos(padre, hijo);
    else if (hijo instanceof Node) padre.append(hijo);
    else padre.append(document.createTextNode(String(hijo)));
  }
}

export default { h };
