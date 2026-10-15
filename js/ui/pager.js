/**
 * @module js/ui/pager
 * @description Paginación accesible reutilizable (anterior / "Página x de y" / siguiente).
 */
import { h } from './dom.js';
import { t } from '../i18n.js';

/**
 * @param {{pagina: number, total: number, tamano: number, etiqueta: string, onIr: (pagina: number) => void}} o
 *   `etiqueta` = texto i18n con {{actual}}, {{total}} y {{filas}}.
 */
export function pager({ pagina, total, tamano, etiqueta, onIr }) {
  const ultima = Math.max(Math.ceil(total / tamano) - 1, 0);
  return h(
    'nav',
    { class: 'pager', 'aria-label': t('common.pagination') },
    h('button', { type: 'button', class: 'button-secondary', disabled: pagina === 0, on: { click: () => onIr(pagina - 1) } }, t('common.previous')),
    h('span', {}, t(etiqueta, { actual: pagina + 1, total: ultima + 1, filas: total })),
    h('button', { type: 'button', class: 'button-secondary', disabled: pagina >= ultima, on: { click: () => onIr(pagina + 1) } }, t('common.next')),
  );
}

export default { pager };
