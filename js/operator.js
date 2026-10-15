/**
 * @module js/operator
 * @description Gestión de operadores (Fase 2 §2: `operator.js`). Ruta
 * `/operadores`, protegida por `operadores.ver`. Alta/edición/inactivación y
 * anonimización exigen `operadores.administrar` (la UI oculta los controles;
 * RLS lo impone en servidor).
 *
 * La anonimización es irreversible (Ley 1581): se pide confirmación explícita
 * en un diálogo con casilla obligatoria antes de llamar al servicio.
 */

import { h } from './ui/dom.js';
import { campo, opcionesDeCatalogo, abrirDialogo } from './ui/forms.js';
import { getOrganizationServices, mensajeDeError } from './organization-services.js';
import { TAMANO_PAGINA_DEFECTO } from './repositories/operadores-repository.js';
import { OrganizationError, CODIGOS_ORGANIZATION } from '../services/organization-error.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from './i18n.js';

export const RUTA_OPERADORES = '/operadores';
const ESPERA_BUSQUEDA_MS = 300;

/**
 * @param {import('./navigation.js').router} router
 * @param {{tienePermiso: (codigo: string) => boolean, empresaActualId: () => string | null}} contexto
 */
export function registrarRutaOperadores(router, contexto) {
  router.registerRoute(RUTA_OPERADORES, {
    title: () => `${t('organization.operadores.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderOperadores(contenedor, contexto),
    meta: {
      permiso: PERMISOS.OPERADORES_VER,
      menu: { etiqueta: 'organization.menu.operadores', orden: 10 },
    },
  });
}

async function renderOperadores(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const puedeAdministrar = contexto.tienePermiso(PERMISOS.OPERADORES_ADMINISTRAR);
  const puedeVerCatalogos = contexto.tienePermiso(PERMISOS.CATALOGOS_VER);
  const filtros = { busqueda: '', estado: '', pagina: 0 };
  let secuencia = 0; // descarta respuestas de consultas superadas

  const busqueda = campo(t('organization.operadores.buscar'), 'input', {
    type: 'search',
    name: 'busqueda',
    maxlength: '60',
    autocomplete: 'off',
  });
  const filtroEstado = campo(
    t('organization.operadores.filtroEstado'),
    'select',
    { name: 'estado' },
    [
      h('option', { value: '' }, t('organization.operadores.todos')),
      h('option', { value: 'activo' }, t('organization.estados.activo')),
      h('option', { value: 'inactivo' }, t('organization.estados.inactivo')),
      h('option', { value: 'anonimizado' }, t('organization.estados.anonimizado')),
    ],
  );
  const mensaje = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const resultados = h('div', { 'aria-live': 'polite' });

  contenedor.append(
    h(
      'section',
      { class: 'org-view' },
      h('h1', {}, t('organization.operadores.title')),
      h(
        'div',
        { class: 'toolbar', role: 'search' },
        busqueda.contenedor,
        filtroEstado.contenedor,
        puedeAdministrar
          ? h('button', { type: 'button', class: 'button-primary', on: { click: () => abrirFormulario(null) } }, t('organization.operadores.nuevo'))
          : null,
      ),
      mensaje,
      resultados,
    ),
  );

  let temporizador = null;
  busqueda.control.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      filtros.busqueda = busqueda.control.value;
      filtros.pagina = 0;
      cargar();
    }, ESPERA_BUSQUEDA_MS);
  });
  filtroEstado.control.addEventListener('change', () => {
    filtros.estado = filtroEstado.control.value;
    filtros.pagina = 0;
    cargar();
  });

  function mostrarError(error) {
    mensaje.textContent = mensajeDeError(error);
    mensaje.hidden = false;
  }

  async function cargar() {
    const mia = ++secuencia;
    mensaje.hidden = true;
    try {
      const servicios = await getOrganizationServices();
      const { filas, total } = await servicios.operadores.listar(empresaId, {
        busqueda: filtros.busqueda,
        estado: filtros.estado || null,
        pagina: filtros.pagina,
      });
      if (mia !== secuencia || !resultados.isConnected) return;
      resultados.replaceChildren(tabla(filas), paginacion(total));
    } catch (error) {
      if (mia === secuencia && resultados.isConnected) {
        resultados.replaceChildren();
        mostrarError(error);
      }
    }
  }

  function tabla(filas) {
    const cuerpo = filas.length
      ? filas.map(fila)
      : [h('tr', {}, h('td', { colspan: '6', class: 'table__empty' }, t('organization.operadores.vacio')))];
    return h(
      'table',
      { class: 'table' },
      h('caption', { class: 'visually-hidden' }, t('organization.operadores.title')),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...['cedula', 'nombre', 'cargo', 'area', 'estado'].map((c) => h('th', { scope: 'col' }, t(`organization.operadores.columnas.${c}`))),
          puedeAdministrar ? h('th', { scope: 'col' }, t('organization.catalogos.columnaAcciones')) : null,
        ),
      ),
      h('tbody', {}, cuerpo),
    );
  }

  function fila(operador) {
    const anonimizado = operador.estado === 'anonimizado';
    const nombreCompleto = anonimizado ? t('organization.operadores.anonimizadoEtiqueta') : `${operador.apellido ?? ''} ${operador.nombre ?? ''}`.trim();
    return h(
      'tr',
      {},
      h('td', {}, anonimizado ? '—' : operador.cedula),
      h('td', {}, nombreCompleto),
      h('td', {}, operador.cargo?.nombre ?? '—'),
      h('td', {}, operador.area?.nombre ?? '—'),
      h('td', {}, h('span', { class: `badge badge--${operador.estado}` }, t(`organization.estados.${operador.estado}`))),
      puedeAdministrar
        ? h('td', { class: 'table__actions' }, anonimizado ? null : accionesFila(operador))
        : null,
    );
  }

  function accionesFila(operador) {
    return [
      h('button', { type: 'button', class: 'button-link', on: { click: () => abrirFormulario(operador) } }, t('organization.catalogos.editar')),
      h(
        'button',
        { type: 'button', class: 'button-link', on: { click: () => alternarEstado(operador) } },
        operador.estado === 'activo' ? t('organization.catalogos.desactivar') : t('organization.catalogos.activar'),
      ),
      h('button', { type: 'button', class: 'button-link button-link--danger', on: { click: () => confirmarAnonimizacion(operador) } }, t('organization.operadores.anonimizar')),
    ];
  }

  function paginacion(total) {
    const ultima = Math.max(Math.ceil(total / TAMANO_PAGINA_DEFECTO) - 1, 0);
    const ir = (pagina) => {
      filtros.pagina = pagina;
      cargar();
    };
    return h(
      'nav',
      { class: 'pager', 'aria-label': t('organization.operadores.paginacion') },
      h('button', { type: 'button', class: 'button-secondary', disabled: filtros.pagina === 0, on: { click: () => ir(filtros.pagina - 1) } }, t('organization.operadores.anterior')),
      h('span', {}, t('organization.operadores.paginaDe', { actual: filtros.pagina + 1, total: ultima + 1, filas: total })),
      h('button', { type: 'button', class: 'button-secondary', disabled: filtros.pagina >= ultima, on: { click: () => ir(filtros.pagina + 1) } }, t('organization.operadores.siguiente')),
    );
  }

  async function alternarEstado(operador) {
    try {
      const servicios = await getOrganizationServices();
      if (operador.estado === 'activo') await servicios.operadores.desactivar(operador.id);
      else await servicios.operadores.activar(operador.id);
      await cargar();
    } catch (error) {
      mostrarError(error);
    }
  }

  async function abrirFormulario(operador) {
    let servicios;
    let catalogos = { cargos: [], areas: [], centros_trabajo: [], lineas_operacionales: [] };
    try {
      servicios = await getOrganizationServices();
      if (puedeVerCatalogos) {
        const nombres = Object.keys(catalogos);
        const listas = await Promise.all(nombres.map((n) => servicios.catalogos.listar(n, empresaId, { soloActivos: true })));
        catalogos = Object.fromEntries(nombres.map((n, i) => [n, listas[i]]));
      }
    } catch (error) {
      mostrarError(error);
      return;
    }

    const texto = (etiqueta, nombre, extra = {}) => campo(etiqueta, 'input', { type: 'text', name: nombre, autocomplete: 'off', ...extra });
    const lista = (etiqueta, nombre, filas, seleccionado) =>
      campo(etiqueta, 'select', { name: nombre }, opcionesDeCatalogo(filas, { vacio: t('organization.sinSeleccion'), seleccionado }));

    const campos = [
      texto(t('organization.operadores.columnas.cedula'), 'cedula', { required: true, inputmode: 'numeric', maxlength: '20', value: operador?.cedula ?? '' }),
      texto(t('organization.operadores.nombre'), 'nombre', { required: true, maxlength: '120', value: operador?.nombre ?? '' }),
      texto(t('organization.operadores.apellido'), 'apellido', { required: true, maxlength: '120', value: operador?.apellido ?? '' }),
      lista(t('organization.operadores.columnas.cargo'), 'cargoId', catalogos.cargos, operador?.cargo_id ?? null),
      lista(t('organization.operadores.columnas.area'), 'areaId', catalogos.areas, operador?.area_id ?? null),
      lista(t('organization.operadores.centroTrabajo'), 'centroTrabajoId', catalogos.centros_trabajo, operador?.centro_trabajo_id ?? null),
      lista(t('organization.operadores.lineaOperacional'), 'lineaOperacionalId', catalogos.lineas_operacionales, operador?.linea_operacional_id ?? null),
      texto(t('organization.operadores.turno'), 'turnoHabitual', { maxlength: '60', value: operador?.turno_habitual ?? '' }),
    ].map((c) => c.contenedor);

    const guardado = await abrirDialogo({
      titulo: operador ? t('organization.operadores.editar') : t('organization.operadores.nuevo'),
      textoConfirmar: t('organization.catalogos.guardar'),
      mensajeDeError,
      contenido: campos,
      onEnviar: async (formulario) => {
        const datos = Object.fromEntries(new FormData(formulario).entries());
        if (operador) await servicios.operadores.actualizar(operador.id, datos);
        else await servicios.operadores.crear(empresaId, datos);
      },
    });
    if (guardado) await cargar();
  }

  async function confirmarAnonimizacion(operador) {
    const casilla = campo(t('organization.operadores.confirmarAnonimizacion'), 'input', { type: 'checkbox', name: 'confirmar', required: true });
    casilla.contenedor.classList.add('form-field--check');
    const hecho = await abrirDialogo({
      titulo: t('organization.operadores.anonimizarTitulo'),
      descripcion: t('organization.operadores.anonimizarAdvertencia'),
      textoConfirmar: t('organization.operadores.anonimizar'),
      peligro: true,
      mensajeDeError,
      contenido: [casilla.contenedor],
      onEnviar: async () => {
        if (!casilla.control.checked) {
          throw new OrganizationError(CODIGOS_ORGANIZATION.VALIDACION, { mensaje: t('organization.operadores.debeConfirmar') });
        }
        const servicios = await getOrganizationServices();
        await servicios.operadores.anonimizar(operador.id, { confirmar: casilla.control.checked });
      },
    });
    if (hecho) await cargar();
  }

  await cargar();
}

export default { registrarRutaOperadores, RUTA_OPERADORES };
