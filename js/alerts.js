/**
 * @module js/alerts
 * @description Bandeja de alertas de operadores. Ruta `/alertas` (`evaluaciones.ver`).
 * Atender o descartar exige `alertas.gestionar` (la UI oculta los botones; RLS lo impone).
 */

import { h } from './ui/dom.js';
import { campo } from './ui/forms.js';
import { pager } from './ui/pager.js';
import { mensajeSeguro } from './ui/errors.js';
import { getDatabase } from './database.js';
import { ReglasService } from '../services/reglas-service.js';
import { TAMANO_PAGINA_ALERTAS } from './repositories/rules-repository.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from './i18n.js';

export const RUTA_ALERTAS = '/alertas';
const ESTADOS = ['abierta', 'atendida', 'descartada'];

export function registrarRutaAlertas(router, contexto) {
  router.registerRoute(RUTA_ALERTAS, {
    title: () => `${t('alertas.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderAlertas(contenedor, contexto),
    meta: { permiso: PERMISOS.EVALUACIONES_VER, menu: { etiqueta: 'alertas.menu', orden: 8 } },
  });
}

async function renderAlertas(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const puedeGestionar = contexto.tienePermiso(PERMISOS.ALERTAS_GESTIONAR);
  const db = await getDatabase();
  const servicio = new ReglasService({ reglas: db.reglas });
  const filtros = { estado: 'abierta', pagina: 0 };
  let secuencia = 0;

  const filtro = campo(
    t('alertas.filtroEstado'),
    'select',
    { name: 'estado' },
    [h('option', { value: '' }, t('alertas.todas')), ...ESTADOS.map((e) => h('option', { value: e, selected: e === filtros.estado }, t(`alertas.estados.${e}`)))],
  );
  const mensaje = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const resultados = h('div', { 'aria-live': 'polite' });
  contenedor.append(h('section', { class: 'org-view' }, h('h1', {}, t('alertas.title')), h('div', { class: 'toolbar' }, filtro.contenedor), mensaje, resultados));

  filtro.control.addEventListener('change', () => {
    filtros.estado = filtro.control.value;
    filtros.pagina = 0;
    cargar();
  });

  async function resolver(alerta, estado) {
    mensaje.hidden = true;
    try {
      await servicio.resolverAlerta(alerta.id, estado);
      await cargar();
    } catch (error) {
      mensaje.textContent = mensajeSeguro(error);
      mensaje.hidden = false;
    }
  }

  async function cargar() {
    const mia = ++secuencia;
    resultados.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const { filas, total } = await db.reglas.listarAlertas(empresaId, { estado: filtros.estado || null, pagina: filtros.pagina });
      if (mia !== secuencia || !resultados.isConnected) return;
      if (filas.length === 0) {
        resultados.replaceChildren(h('p', { class: 'table__empty' }, t('alertas.vacio')));
        return;
      }
      const filasDom = filas.map((a) =>
        h(
          'tr',
          {},
          h('td', {}, new Date(a.created_at).toLocaleString('es-CO')),
          h('td', {}, h('span', { class: `badge badge--sev-${a.severidad}` }, t(`alertas.severidades.${a.severidad}`))),
          h('td', {}, a.mensaje),
          h('td', {}, a.regla?.nombre ?? '—'),
          h('td', {}, t(`alertas.estados.${a.estado}`)),
          h(
            'td',
            { class: 'table__actions' },
            puedeGestionar && a.estado === 'abierta'
              ? [
                  h('button', { type: 'button', class: 'button-link', on: { click: () => resolver(a, 'atendida') } }, t('alertas.atender')),
                  h('button', { type: 'button', class: 'button-link button-link--danger', on: { click: () => resolver(a, 'descartada') } }, t('alertas.descartar')),
                ]
              : null,
          ),
        ),
      );
      resultados.replaceChildren(
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, ...['fecha', 'severidad', 'mensaje', 'regla', 'estado', 'acciones'].map((k) => h('th', { scope: 'col' }, t(`alertas.${k}`))))),
          h('tbody', {}, filasDom),
        ),
        pager({ pagina: filtros.pagina, total, tamano: TAMANO_PAGINA_ALERTAS, etiqueta: 'alertas.paginaDe', onIr: (p) => { filtros.pagina = p; cargar(); } }),
      );
    } catch (error) {
      if (mia !== secuencia) return;
      resultados.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    }
  }

  await cargar();
}

export default { registrarRutaAlertas, RUTA_ALERTAS };
