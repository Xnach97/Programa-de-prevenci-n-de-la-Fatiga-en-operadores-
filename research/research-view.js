/**
 * @module research/research-view
 * @description Plataforma de investigación (Fase 3 §11). Ruta `/investigacion`,
 * permiso `investigacion.acceder`.
 *  - Cohortes: crear con criterio (área/cargo), incorporar operadores CON consentimiento
 *    de investigación vigente, eliminar y exportar un dataset ANONIMIZADO (CSV) si el
 *    usuario tiene `datos.exportar`.
 *  - Consentimientos de investigación (si el usuario tiene `operadores.ver`): otorgar o
 *    revocar. Es un consentimiento distinto del de evaluación SST (laboral).
 * Todo texto se inserta con `h()` (nunca innerHTML).
 */

import { h } from '../js/ui/dom.js';
import { campo, opcionesDeCatalogo, abrirDialogo } from '../js/ui/forms.js';
import { pager } from '../js/ui/pager.js';
import { mensajeSeguro } from '../js/ui/errors.js';
import { getDatabase } from '../js/database.js';
import { ResearchService } from './research-service.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from '../js/i18n.js';

export const RUTA_INVESTIGACION = '/investigacion';
const TAMANO = 15;

export function registrarRutaInvestigacion(router, contexto) {
  router.registerRoute(RUTA_INVESTIGACION, {
    title: () => `${t('research.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderInvestigacion(contenedor, contexto),
    meta: { permiso: PERMISOS.INVESTIGACION_ACCEDER, menu: { etiqueta: 'research.menu', orden: 60 } },
  });
}

/** Descarga un texto como archivo sin servidor. */
export function descargarTexto(nombre, texto, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  // `h()` descarta esquemas no http(s) (blob:) por seguridad: el enlace se crea a mano, con una URL propia.
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderInvestigacion(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const db = await getDatabase();
  const servicio = new ResearchService({ research: db.research });
  const puedeExportar = contexto.tienePermiso(PERMISOS.DATOS_EXPORTAR);
  const puedeVerOperadores = contexto.tienePermiso(PERMISOS.OPERADORES_VER);
  const puedeConsentir = puedeVerOperadores && contexto.tienePermiso(PERMISOS.OPERADORES_ADMINISTRAR);

  const [areas, cargos] = await Promise.all([db.catalogos.listar('areas', empresaId, { incluirInactivos: false }), db.catalogos.listar('cargos', empresaId, { incluirInactivos: false })]);
  const nombreDe = (lista, id) => lista.find((x) => x.id === id)?.nombre ?? '—';

  const mensaje = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const aviso = h('div', { class: 'form-ok', role: 'status', hidden: true });
  const mostrarError = (error) => { aviso.hidden = true; mensaje.textContent = mensajeSeguro(error); mensaje.hidden = false; };
  const mostrarOk = (texto) => { mensaje.hidden = true; aviso.textContent = texto; aviso.hidden = false; };

  const zonaCohortes = h('div', { 'aria-live': 'polite' });
  const zonaConsentimientos = h('div', { 'aria-live': 'polite' });
  contenedor.append(
    h(
      'section',
      { class: 'org-view' },
      h('h1', {}, t('research.title')),
      h('p', { class: 'dialog__description' }, t('research.aviso')),
      mensaje,
      aviso,
      h('h2', {}, t('research.cohortes.title')),
      h('button', { type: 'button', class: 'button-primary', on: { click: nuevaCohorte } }, t('research.cohortes.nueva')),
      zonaCohortes,
      puedeVerOperadores ? h('h2', {}, t('research.consentimientos.title')) : null,
      puedeVerOperadores ? h('p', { class: 'dialog__description' }, t('research.consentimientos.ayuda')) : null,
      zonaConsentimientos,
    ),
  );

  // ---------------------------------------------------------------- cohortes
  async function cargarCohortes() {
    zonaCohortes.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const cohortes = await servicio.listarCohortes(empresaId);
      if (!zonaCohortes.isConnected) return;
      if (cohortes.length === 0) {
        zonaCohortes.replaceChildren(h('p', { class: 'table__empty' }, t('research.cohortes.vacio')));
        return;
      }
      zonaCohortes.replaceChildren(
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, ['nombre', 'criterio', 'miembros', 'acciones'].map((k) => h('th', { scope: 'col' }, t(`research.cohortes.col.${k}`))))),
          h(
            'tbody',
            {},
            cohortes.map((c) =>
              h(
                'tr',
                {},
                h('td', {}, c.nombre),
                h('td', {}, [c.criterio?.area_id ? `${t('research.cohortes.area')}: ${nombreDe(areas, c.criterio.area_id)}` : null, c.criterio?.cargo_id ? `${t('research.cohortes.cargo')}: ${nombreDe(cargos, c.criterio.cargo_id)}` : null].filter(Boolean).join(' · ') || t('research.cohortes.sinCriterio')),
                h('td', {}, String(c.miembros)),
                h(
                  'td',
                  { class: 'table__actions' },
                  h('button', { type: 'button', class: 'button-secondary', on: { click: () => poblar(c) } }, t('research.cohortes.poblar')),
                  puedeExportar ? h('button', { type: 'button', class: 'button-secondary', on: { click: () => exportar(c) } }, t('research.cohortes.exportar')) : null,
                  h('button', { type: 'button', class: 'button-danger', on: { click: () => eliminar(c) } }, t('research.cohortes.eliminar')),
                ),
              ),
            ),
          ),
        ),
      );
    } catch (error) {
      zonaCohortes.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    }
  }

  async function nuevaCohorte() {
    const nombre = campo(t('research.cohortes.nombre'), 'input', { name: 'nombre', maxlength: '120', required: true });
    const area = campo(t('research.cohortes.area'), 'select', { name: 'area' }, opcionesDeCatalogo(areas, { vacio: t('research.cohortes.cualquiera') }));
    const cargo = campo(t('research.cohortes.cargo'), 'select', { name: 'cargo' }, opcionesDeCatalogo(cargos, { vacio: t('research.cohortes.cualquiera') }));
    const ok = await abrirDialogo({
      titulo: t('research.cohortes.nueva'),
      descripcion: t('research.cohortes.criterioAyuda'),
      contenido: [nombre.contenedor, area.contenedor, cargo.contenedor],
      textoConfirmar: t('research.cohortes.crear'),
      onEnviar: () => servicio.crearCohorte({ empresaId, nombre: nombre.control.value, areaId: area.control.value || null, cargoId: cargo.control.value || null }),
      mensajeDeError: mensajeSeguro,
    });
    if (ok) {
      mostrarOk(t('research.cohortes.creada'));
      await cargarCohortes();
    }
  }

  async function poblar(c) {
    try {
      const n = await servicio.poblarCohorte(c.id);
      mostrarOk(t('research.cohortes.poblada', { n }));
      await cargarCohortes();
    } catch (error) {
      mostrarError(error);
    }
  }

  async function eliminar(c) {
    const ok = await abrirDialogo({
      titulo: t('research.cohortes.eliminar'),
      descripcion: t('research.cohortes.eliminarConfirmar', { nombre: c.nombre }),
      contenido: [],
      textoConfirmar: t('research.cohortes.eliminar'),
      peligro: true,
      onEnviar: () => servicio.eliminarCohorte(c.id),
      mensajeDeError: mensajeSeguro,
    });
    if (ok) await cargarCohortes();
  }

  async function exportar(c) {
    const desde = campo(t('research.exportar.desde'), 'input', { type: 'date', name: 'desde' });
    const hasta = campo(t('research.exportar.hasta'), 'input', { type: 'date', name: 'hasta' });
    let resultado = null;
    const ok = await abrirDialogo({
      titulo: t('research.exportar.title', { nombre: c.nombre }),
      descripcion: t('research.exportar.ayuda'),
      contenido: [desde.contenedor, hasta.contenedor],
      textoConfirmar: t('research.exportar.descargar'),
      onEnviar: async () => {
        resultado = await servicio.exportarCsv({ empresaId, cohorteId: c.id, desde: desde.control.value || null, hasta: hasta.control.value || null });
        descargarTexto(resultado.nombreArchivo, resultado.csv);
      },
      mensajeDeError: mensajeSeguro,
    });
    if (ok && resultado) mostrarOk(t('research.exportar.listo', { filas: resultado.filas, participantes: resultado.participantes }));
  }

  // ---------------------------------------------------------- consentimientos
  let pagina = 0;
  async function cargarConsentimientos() {
    if (!puedeVerOperadores) return;
    zonaConsentimientos.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const { filas, total } = await db.operadores.listar(empresaId, { estado: 'activo', pagina, tamano: TAMANO });
      const estados = await servicio.consentimientos(empresaId, filas.map((f) => f.id));
      if (!zonaConsentimientos.isConnected) return;
      if (filas.length === 0) {
        zonaConsentimientos.replaceChildren(h('p', { class: 'table__empty' }, t('research.consentimientos.vacio')));
        return;
      }
      const texto = (id) => (estados.has(id) ? (estados.get(id) ? t('research.consentimientos.otorgado') : t('research.consentimientos.revocado')) : t('research.consentimientos.sinRegistro'));
      zonaConsentimientos.replaceChildren(
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, ['operador', 'estado', 'acciones'].map((k) => h('th', { scope: 'col' }, t(`research.consentimientos.col.${k}`))))),
          h(
            'tbody',
            {},
            filas.map((f) =>
              h(
                'tr',
                {},
                h('td', {}, `${f.nombre ?? ''} ${f.apellido ?? ''} (${f.cedula})`.trim()),
                h('td', {}, texto(f.id)),
                h(
                  'td',
                  {},
                  puedeConsentir
                    ? estados.get(f.id) === true
                      ? h('button', { type: 'button', class: 'button-danger', on: { click: () => cambiarConsentimiento(f, false) } }, t('research.consentimientos.revocar'))
                      : h('button', { type: 'button', class: 'button-secondary', on: { click: () => cambiarConsentimiento(f, true) } }, t('research.consentimientos.otorgar'))
                    : null,
                ),
              ),
            ),
          ),
        ),
        pager({ pagina, total, tamano: TAMANO, etiqueta: 'research.consentimientos.paginaDe', onIr: (p) => { pagina = p; cargarConsentimientos(); } }),
      );
    } catch (error) {
      zonaConsentimientos.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    }
  }

  async function cambiarConsentimiento(operador, otorgado) {
    const documento = campo(t('research.consentimientos.documento'), 'input', { type: 'url', name: 'documento', placeholder: 'https://' });
    const ok = await abrirDialogo({
      titulo: otorgado ? t('research.consentimientos.otorgar') : t('research.consentimientos.revocar'),
      descripcion: otorgado ? t('research.consentimientos.otorgarConfirmar') : t('research.consentimientos.revocarConfirmar'),
      contenido: otorgado ? [documento.contenedor] : [],
      textoConfirmar: otorgado ? t('research.consentimientos.otorgar') : t('research.consentimientos.revocar'),
      peligro: !otorgado,
      onEnviar: () => servicio.registrarConsentimiento({ empresaId, operadorId: operador.id, otorgado, documentoUrl: otorgado ? documento.control.value.trim() : null }),
      mensajeDeError: mensajeSeguro,
    });
    if (ok) {
      mostrarOk(otorgado ? t('research.consentimientos.registradoOtorgado') : t('research.consentimientos.registradoRevocado'));
      await Promise.all([cargarConsentimientos(), cargarCohortes()]);
    }
  }

  await Promise.all([cargarCohortes(), cargarConsentimientos()]);
}

export default { registrarRutaInvestigacion, RUTA_INVESTIGACION, descargarTexto };
