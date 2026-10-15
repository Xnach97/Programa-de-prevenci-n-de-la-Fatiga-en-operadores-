/**
 * @module admin/catalogos
 * @description Administración de los catálogos organizacionales (Fase 2 §2:
 * `admin/catalogos.js`). Ruta `/admin/catalogos`, protegida por `catalogos.ver`.
 * Crear, renombrar y activar/desactivar exigen `catalogos.editar` (la UI oculta
 * los controles; RLS lo impone en servidor).
 *
 * Un catálogo en uso NO se borra: se desactiva (Fase 3 §5), por eso no hay
 * acción de eliminar.
 */

import { h } from '../js/ui/dom.js';
import { campo, opcionesDeCatalogo, abrirDialogo } from '../js/ui/forms.js';
import { getOrganizationServices, mensajeDeError } from '../js/organization-services.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from '../js/i18n.js';

export const RUTA_CATALOGOS = '/admin/catalogos';
const CATALOGOS = Object.freeze(['areas', 'cargos', 'centros_trabajo', 'procesos', 'lineas_operacionales']);
/** Catálogo padre de los que tienen relación opcional. */
const PADRES = Object.freeze({ cargos: 'areas', lineas_operacionales: 'procesos' });

/**
 * Registra la ruta de catálogos.
 * @param {import('../js/navigation.js').router} router
 * @param {{
 *   tienePermiso: (codigo: string) => boolean,
 *   empresaActualId: () => string | null,
 * }} contexto
 */
export function registrarRutaCatalogos(router, contexto) {
  router.registerRoute(RUTA_CATALOGOS, {
    title: () => `${t('organization.catalogos.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderCatalogos(contenedor, contexto),
    meta: {
      permiso: PERMISOS.CATALOGOS_VER,
      menu: { etiqueta: 'organization.menu.catalogos', orden: 20 },
    },
  });
}

async function renderCatalogos(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const puedeEditar = contexto.tienePermiso(PERMISOS.CATALOGOS_EDITAR);
  const estado = { catalogo: CATALOGOS[0] };

  const tabs = h('div', { role: 'tablist', 'aria-label': t('organization.catalogos.tabsLabel'), class: 'tabs' });
  const panel = h('div', { role: 'tabpanel', class: 'tabs__panel', tabindex: '0' });
  contenedor.append(
    h('section', { class: 'org-view' }, h('h1', {}, t('organization.catalogos.title')), tabs, panel),
  );

  const seleccionar = async (catalogo) => {
    estado.catalogo = catalogo;
    pintarTabs();
    await pintarPanel();
  };

  function pintarTabs() {
    tabs.replaceChildren(
      ...CATALOGOS.map((catalogo) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'tabs__tab',
            id: `tab-${catalogo}`,
            'aria-selected': String(catalogo === estado.catalogo),
            tabindex: catalogo === estado.catalogo ? '0' : '-1',
            on: {
              click: () => seleccionar(catalogo),
              keydown: (evento) => navegarTabsConTeclado(evento, catalogo, seleccionar),
            },
          },
          t(`organization.catalogos.nombres.${catalogo}`),
        ),
      ),
    );
    panel.setAttribute('aria-labelledby', `tab-${estado.catalogo}`);
  }

  async function pintarPanel() {
    const catalogo = estado.catalogo;
    panel.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const servicios = await getOrganizationServices();
      const [filas, padres] = await Promise.all([
        servicios.catalogos.listar(catalogo, empresaId),
        PADRES[catalogo] ? servicios.catalogos.listar(PADRES[catalogo], empresaId) : Promise.resolve([]),
      ]);
      if (catalogo !== estado.catalogo || !panel.isConnected) return; // respuesta obsoleta
      panel.replaceChildren(tablaCatalogo({ catalogo, filas, padres, puedeEditar, servicios, empresaId, recargar: pintarPanel }));
    } catch (error) {
      if (catalogo !== estado.catalogo || !panel.isConnected) return;
      panel.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeDeError(error)));
    }
  }

  pintarTabs();
  await pintarPanel();
}

/** Flechas ←/→ y Inicio/Fin entre pestañas (patrón WAI-ARIA Tabs). */
function navegarTabsConTeclado(evento, actual, seleccionar) {
  const indice = CATALOGOS.indexOf(actual);
  const destinos = {
    ArrowRight: CATALOGOS[(indice + 1) % CATALOGOS.length],
    ArrowLeft: CATALOGOS[(indice - 1 + CATALOGOS.length) % CATALOGOS.length],
    Home: CATALOGOS[0],
    End: CATALOGOS[CATALOGOS.length - 1],
  };
  const destino = destinos[evento.key];
  if (!destino) return;
  evento.preventDefault();
  seleccionar(destino).then(() => document.getElementById(`tab-${destino}`)?.focus());
}

function tablaCatalogo({ catalogo, filas, padres, puedeEditar, servicios, empresaId, recargar }) {
  const nombrePadre = new Map(padres.map((p) => [p.id, p.nombre]));
  const columnaPadre = PADRES[catalogo] ? `organization.catalogos.padre.${catalogo}` : null;
  const etiquetaCatalogo = t(`organization.catalogos.nombres.${catalogo}`);

  const abrirEdicion = (fila) =>
    abrirDialogo({
      titulo: fila ? t('organization.catalogos.editar') : t('organization.catalogos.crear'),
      textoConfirmar: t('organization.catalogos.guardar'),
      mensajeDeError,
      contenido: camposFormulario({ catalogo, fila, padres }),
      onEnviar: async (formulario) => {
        const datos = new FormData(formulario);
        const nombre = String(datos.get('nombre') ?? '');
        const padreId = PADRES[catalogo] ? String(datos.get('padreId') ?? '') || null : undefined;
        if (fila) await servicios.catalogos.actualizar(catalogo, fila.id, { nombre, padreId });
        else await servicios.catalogos.crear(catalogo, empresaId, { nombre, padreId });
      },
    }).then((cambio) => cambio && recargar());

  const alternarEstado = async (fila) => {
    try {
      if (fila.estado === 'activo') await servicios.catalogos.desactivar(catalogo, fila.id);
      else await servicios.catalogos.activar(catalogo, fila.id);
      await recargar();
    } catch (error) {
      anunciarError(mensajeDeError(error));
    }
  };

  const cuerpo = filas.length
    ? filas.map((fila) =>
        h(
          'tr',
          {},
          h('td', {}, fila.nombre),
          columnaPadre ? h('td', {}, nombrePadre.get(fila[PADRES[catalogo] === 'areas' ? 'area_id' : 'proceso_id']) ?? '—') : null,
          h('td', {}, h('span', { class: `badge badge--${fila.estado}` }, t(`organization.estados.${fila.estado}`))),
          puedeEditar
            ? h(
                'td',
                { class: 'table__actions' },
                h('button', { type: 'button', class: 'button-link', on: { click: () => abrirEdicion(fila) } }, t('organization.catalogos.editar')),
                h(
                  'button',
                  { type: 'button', class: 'button-link', on: { click: () => alternarEstado(fila) } },
                  fila.estado === 'activo' ? t('organization.catalogos.desactivar') : t('organization.catalogos.activar'),
                ),
              )
            : null,
        ),
      )
    : [h('tr', {}, h('td', { colspan: '4', class: 'table__empty' }, t('organization.catalogos.vacio')))];

  return h(
    'div',
    {},
    puedeEditar
      ? h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'button-primary', on: { click: () => abrirEdicion(null) } }, t('organization.catalogos.crear')))
      : null,
    h('div', { id: 'catalogos-mensaje', role: 'alert', class: 'form-error', hidden: true }),
    h(
      'table',
      { class: 'table' },
      h('caption', { class: 'visually-hidden' }, etiquetaCatalogo),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, t('organization.catalogos.columnaNombre')),
          columnaPadre ? h('th', { scope: 'col' }, t(columnaPadre)) : null,
          h('th', { scope: 'col' }, t('organization.catalogos.columnaEstado')),
          puedeEditar ? h('th', { scope: 'col' }, t('organization.catalogos.columnaAcciones')) : null,
        ),
      ),
      h('tbody', {}, cuerpo),
    ),
  );
}

function camposFormulario({ catalogo, fila, padres }) {
  const nombre = campo(t('organization.catalogos.columnaNombre'), 'input', {
    type: 'text',
    name: 'nombre',
    required: true,
    maxlength: '120',
    value: fila?.nombre ?? '',
    autocomplete: 'off',
  });
  const campos = [nombre.contenedor];
  if (PADRES[catalogo]) {
    const columna = PADRES[catalogo] === 'areas' ? 'area_id' : 'proceso_id';
    const padre = campo(
      t(`organization.catalogos.padre.${catalogo}`),
      'select',
      { name: 'padreId' },
      opcionesDeCatalogo(
        padres.filter((p) => p.estado === 'activo' || p.id === fila?.[columna]),
        { vacio: t('organization.sinSeleccion'), seleccionado: fila?.[columna] ?? null },
      ),
    );
    campos.push(padre.contenedor);
  }
  return campos;
}

function anunciarError(mensaje) {
  const caja = document.getElementById('catalogos-mensaje');
  if (!caja) return;
  caja.textContent = mensaje;
  caja.hidden = false;
}

export default { registrarRutaCatalogos, RUTA_CATALOGOS };
