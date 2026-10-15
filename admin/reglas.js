/**
 * @module admin/reglas
 * @description Administración de reglas de alerta (Fase 3 §9). Ruta
 * `/admin/reglas`, permiso `configuracion.editar`.
 *
 * Constructor de condiciones SIN texto libre: cada condición se arma con listas
 * (indicador, operador, tipo de referencia) y un número, y se combinan con Y/O.
 * Las reglas globales son de solo lectura para las empresas.
 */

import { h } from '../js/ui/dom.js';
import { campo, abrirDialogo } from '../js/ui/forms.js';
import { mensajeSeguro } from '../js/ui/errors.js';
import { getDatabase } from '../js/database.js';
import { ReglasService } from '../services/reglas-service.js';
import { OPERADORES, SEVERIDADES, construirCondicion } from '../statistics/rules.js';
import { testRegistry } from '../tests/index.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from '../js/i18n.js';

export const RUTA_REGLAS = '/admin/reglas';
const MAX_CONDICIONES = 4;
const INDICADORES_BASE = ['ico', 'ico_trabajador', 'indice_atencion', 'indice_fatiga', 'indice_riesgo'];

export function registrarRutaReglas(router, contexto) {
  router.registerRoute(RUTA_REGLAS, {
    title: () => `${t('admin.reglas.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderReglas(contenedor, contexto),
    meta: { permiso: PERMISOS.CONFIGURACION_EDITAR, menu: { etiqueta: 'admin.menu.reglas', orden: 40 } },
  });
}

/** Opciones de indicador: base + <prueba>.<tiempo|puntaje|errores> de las pruebas registradas. */
export function opcionesIndicador() {
  const base = INDICADORES_BASE.map((codigo) => ({ valor: codigo, texto: t(`admin.reglas.indicadores.${codigo}`) }));
  const pruebas = testRegistry.list().flatMap((p) =>
    ['tiempo', 'puntaje', 'errores'].map((m) => ({ valor: `${p.codigo}.${m}`, texto: `${p.codigo} · ${t(`admin.reglas.indicadores.${m}`)}` })),
  );
  return [...base, ...pruebas];
}

async function renderReglas(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const db = await getDatabase();
  const servicio = new ReglasService({ reglas: db.reglas });
  const mensaje = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const lista = h('div', { 'aria-live': 'polite' });
  contenedor.append(
    h(
      'section',
      { class: 'org-view' },
      h('h1', {}, t('admin.reglas.title')),
      h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'button-primary', on: { click: () => abrirNueva() } }, t('admin.reglas.nueva'))),
      mensaje,
      lista,
    ),
  );

  async function cambiarEstado(regla) {
    mensaje.hidden = true;
    try {
      await servicio.cambiarEstadoRegla(regla.id, regla.estado === 'activa' ? 'inactiva' : 'activa');
      await cargar();
    } catch (error) {
      mensaje.textContent = mensajeSeguro(error);
      mensaje.hidden = false;
    }
  }

  async function cargar() {
    lista.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const reglas = await db.reglas.listarReglas(empresaId, { soloActivas: false });
      if (!lista.isConnected) return;
      if (reglas.length === 0) {
        lista.replaceChildren(h('p', { class: 'table__empty' }, t('admin.reglas.vacio')));
        return;
      }
      lista.replaceChildren(
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, ...['nombre', 'severidad', 'ambito', 'estado', 'acciones'].map((k) => h('th', { scope: 'col' }, t(`admin.reglas.${k}`))))),
          h(
            'tbody',
            {},
            reglas.map((r) =>
              h(
                'tr',
                {},
                h('td', {}, r.nombre),
                h('td', {}, t(`admin.reglas.severidades.${r.severidad}`)),
                h('td', {}, r.empresa_id ? t('admin.reglas.empresa') : t('admin.reglas.global')),
                h('td', {}, t(`admin.reglas.estados.${r.estado}`)),
                h(
                  'td',
                  { class: 'table__actions' },
                  r.empresa_id
                    ? h('button', { type: 'button', class: 'button-link', on: { click: () => cambiarEstado(r) } }, r.estado === 'activa' ? t('admin.reglas.desactivar') : t('admin.reglas.activar'))
                    : null,
                ),
              ),
            ),
          ),
        ),
      );
    } catch (error) {
      lista.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    }
  }

  function filaCondicion() {
    const indicador = campo(t('admin.reglas.indicador'), 'select', { name: 'indicador' }, opcionesIndicador().map((o) => h('option', { value: o.valor }, o.texto)));
    const op = campo(t('admin.reglas.operador'), 'select', { name: 'op' }, OPERADORES.map((o) => h('option', { value: o }, o)));
    const tipo = campo(t('admin.reglas.referencia'), 'select', { name: 'tipo' }, [
      h('option', { value: 'valor' }, t('admin.reglas.valor')),
      h('option', { value: 'percentil' }, t('admin.reglas.percentil')),
    ]);
    const numero = campo(t('admin.reglas.numero'), 'input', { name: 'numero', type: 'number', step: 'any', required: true });
    return {
      nodo: h('fieldset', { class: 'condicion' }, indicador.contenedor, op.contenedor, tipo.contenedor, numero.contenedor),
      leer: () => ({ indicador: indicador.control.value, op: op.control.value, tipo: tipo.control.value, numero: Number(numero.control.value) }),
      vacio: () => numero.control.value.trim() === '',
    };
  }

  function abrirNueva() {
    const nombre = campo(t('admin.reglas.nombre'), 'input', { name: 'nombre', maxlength: '120', required: true });
    const severidad = campo(t('admin.reglas.severidad'), 'select', { name: 'severidad' }, SEVERIDADES.map((s) => h('option', { value: s }, t(`admin.reglas.severidades.${s}`))));
    const texto = campo(t('admin.reglas.mensaje'), 'input', { name: 'mensaje', maxlength: '400', required: true });
    const combinador = campo(t('admin.reglas.combinador'), 'select', { name: 'combinador' }, [
      h('option', { value: 'and' }, t('admin.reglas.y')),
      h('option', { value: 'or' }, t('admin.reglas.o')),
    ]);
    const filas = [filaCondicion()];
    const zona = h('div', {}, filas[0].nodo);
    const agregar = h(
      'button',
      {
        type: 'button',
        class: 'button-secondary',
        on: {
          click: () => {
            if (filas.length >= MAX_CONDICIONES) return;
            const f = filaCondicion();
            filas.push(f);
            zona.append(f.nodo);
          },
        },
      },
      '+',
    );
    abrirDialogo({
      titulo: t('admin.reglas.nueva'),
      contenido: [nombre.contenedor, severidad.contenedor, texto.contenedor, h('p', { class: 'dialog__description' }, t('admin.reglas.mensajeAyuda')), h('h3', {}, t('admin.reglas.condiciones')), zona, agregar, combinador.contenedor],
      textoConfirmar: t('admin.reglas.crear'),
      mensajeDeError: mensajeSeguro,
      onEnviar: async () => {
        if (filas.some((f) => f.vacio())) throw Object.assign(new Error(t('organization.errors.validacion')), { codigo: 'validacion' });
        await servicio.crearRegla({
          empresaId,
          nombre: nombre.control.value,
          severidad: severidad.control.value,
          mensajePlantilla: texto.control.value,
          condicion: construirCondicion(filas.map((f) => f.leer()), combinador.control.value),
        });
        await cargar();
      },
    });
  }

  await cargar();
}

export default { registrarRutaReglas, RUTA_REGLAS };
