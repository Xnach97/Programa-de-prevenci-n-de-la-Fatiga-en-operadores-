/**
 * @module js/offline-status
 * @description Arranque del Offline Engine y aviso visible de estado:
 *  - sin conexión,
 *  - N evaluaciones pendientes de envío (con la antigüedad de la más vieja),
 *  - aviso al supervisor cuando alguna lleva demasiado tiempo pendiente,
 *  - evaluaciones rechazadas por el servidor (reintentar / descartar).
 * La cola se sincroniza al iniciar sesión, al recuperar la red y cada 30 s.
 */

import { h } from './ui/dom.js';
import { t } from './i18n.js';
import { eventBus } from '../services/event-bus.js';
import { AUTH_EVENTS } from '../services/auth-service.js';
import { getCola } from './offline.js';
import { purgarCache } from './offline-storage.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('offline-status');

/** '2 h 15 min' / '12 min' / 'menos de 1 min'. */
export function formatearAntiguedad(ms) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('offline.menosDeUnMinuto');
  const horas = Math.floor(min / 60);
  return horas ? `${horas} h ${min % 60} min` : `${min} min`;
}

export function initOfflineModule({ documento = document, ventana = window } = {}) {
  const banner = h('div', { id: 'offline-banner', class: 'offline-banner', role: 'status', 'aria-live': 'polite', hidden: true });
  documento.querySelector('.app-header')?.after(banner);
  let cola = null;
  let sincronizando = false;

  async function pintar() {
    const enLinea = ventana.navigator.onLine !== false;
    const e = cola ? await cola.estado() : { pendientes: 0, rechazadas: 0, masAntiguaMs: 0, vencida: false };
    const lineas = [];
    if (!enLinea) lineas.push(h('span', {}, t('offline.sinConexion')));
    if (e.pendientes > 0) {
      lineas.push(h('span', {}, t('offline.pendientes', { n: e.pendientes, antiguedad: formatearAntiguedad(e.masAntiguaMs) })));
      if (e.vencida) lineas.push(h('strong', { class: 'offline-banner__alerta' }, t('offline.avisoSupervisor')));
      lineas.push(h('button', { type: 'button', class: 'button-secondary', disabled: sincronizando || !enLinea, on: { click: () => sincronizar(true) } }, t('offline.sincronizar')));
    }
    if (e.rechazadas > 0) {
      lineas.push(h('span', { class: 'offline-banner__alerta' }, t('offline.rechazadas', { n: e.rechazadas })));
      lineas.push(h('button', { type: 'button', class: 'button-secondary', on: { click: async () => { await cola.reintentarRechazadas(); sincronizar(true); } } }, t('offline.reintentar')));
      lineas.push(h('button', { type: 'button', class: 'button-secondary', on: { click: () => cola.descartarRechazadas() } }, t('offline.descartar')));
    }
    banner.hidden = lineas.length === 0;
    banner.dataset.vencida = String(e.vencida);
    banner.replaceChildren(...lineas);
  }

  async function sincronizar(forzar) {
    if (!cola || sincronizando) return;
    sincronizando = true;
    try {
      await cola.sincronizar({ forzar });
    } catch (error) {
      logger.warn('Sincronización manual falló', { error: String(error) });
    } finally {
      sincronizando = false;
      pintar();
    }
  }

  async function arrancar() {
    try {
      cola = await getCola();
      cola.suscribir(pintar);
      cola.iniciar({ ventana });
      pintar();
    } catch (error) {
      logger.warn('No se pudo iniciar la cola offline', { error: String(error) });
    }
  }

  ventana.addEventListener('online', pintar);
  ventana.addEventListener('offline', pintar);
  eventBus.on(AUTH_EVENTS.SIGNED_IN, arrancar);
  eventBus.on(AUTH_EVENTS.SESSION_RESTORED, arrancar);
  eventBus.on(AUTH_EVENTS.SIGNED_OUT, async () => {
    cola?.detener();
    await purgarCache();
    pintar();
  });
  pintar();
  return { pintar };
}

export default { initOfflineModule, formatearAntiguedad };
