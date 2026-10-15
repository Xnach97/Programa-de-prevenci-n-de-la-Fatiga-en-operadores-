/**
 * @module admin/configuracion
 * @description Configuración de la empresa (Fase 2 §2: `admin/configuracion.js`).
 * Ruta `/admin/configuracion`, permiso `configuracion.editar`. Tres secciones
 * independientes: general (marca, turnos, pruebas, modalidad), pesos del ICO y
 * baremo del ICO. Cada una se guarda por separado; los pesos y el baremo se
 * PUBLICAN como una versión nueva (nunca se edita la anterior).
 */

import { h } from '../js/ui/dom.js';
import { campo } from '../js/ui/forms.js';
import { mensajeSeguro } from '../js/ui/errors.js';
import { getDatabase } from '../js/database.js';
import { getScientificServices } from '../js/scientific.js';
import { ConfiguracionService, MODALIDADES_BAREMO } from '../services/configuracion-service.js';
import { turnosDeEmpresa } from '../services/evaluacion-service.js';
import { testRegistry } from '../tests/index.js';
import { marcaATokens } from '../js/brand.js';
import { applyBrandTokens } from '../js/theming.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from '../js/i18n.js';

export const RUTA_CONFIGURACION = '/admin/configuracion';

export function registrarRutaConfiguracion(router, contexto) {
  router.registerRoute(RUTA_CONFIGURACION, {
    title: () => `${t('admin.configuracion.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderConfiguracion(contenedor, contexto),
    meta: { permiso: PERMISOS.CONFIGURACION_EDITAR, menu: { etiqueta: 'admin.menu.configuracion', orden: 30 } },
  });
}

/** Mensaje de estado reutilizable (éxito o error) para una sección. */
function crearEstado() {
  const nodo = h('p', { role: 'status', 'aria-live': 'polite', class: 'test-feedback' });
  return {
    nodo,
    ok: (texto) => { nodo.className = 'test-feedback'; nodo.textContent = texto; },
    error: (e) => { nodo.className = 'form-error'; nodo.textContent = mensajeSeguro(e); },
    limpiar: () => { nodo.textContent = ''; },
  };
}

const numeroOVacio = (control) => (control.value.trim() === '' ? NaN : Number(control.value));

async function renderConfiguracion(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const raiz = h('section', { class: 'org-view' }, h('h1', {}, t('admin.configuracion.title')));
  contenedor.append(raiz);

  let db; let cfg; let pruebas; let icoVigente; let baremoVigente; let servicio;
  try {
    db = await getDatabase();
    const { configuracion } = await getScientificServices();
    servicio = new ConfiguracionService({ empresas: db.empresas, cientifica: configuracion, codigosPruebas: () => testRegistry.list().map((p) => p.codigo) });
    const ahora = Date.now();
    const vigente = (f) => new Date(f.vigente_desde).getTime() <= ahora && (!f.vigente_hasta || new Date(f.vigente_hasta).getTime() > ahora);
    const [c, activas, icos, baremos] = await Promise.all([db.empresas.obtenerConfiguracion(empresaId), db.testing.listarActivas(), db.ico.listar(empresaId), db.baremos.listar(empresaId)]);
    cfg = c ?? {};
    pruebas = activas.filter((p) => testRegistry.has(p.codigo));
    icoVigente = icos.find((f) => f.cargo_id === null && vigente(f)) ?? null;
    baremoVigente = baremos.find((f) => f.empresa_id === empresaId && f.prueba_id === null && f.modalidad !== 'cientifico' && vigente(f)) ?? null;
  } catch (error) {
    raiz.append(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    return;
  }

  raiz.append(seccionGeneral(), seccionPesos(), seccionBaremo());

  // ----------------------------------------------------------------- general
  function seccionGeneral() {
    const marca = cfg.marca ?? {};
    const estado = crearEstado();
    const col = (clave, etiqueta) => campo(etiqueta, 'input', { name: clave, maxlength: '7', autocomplete: 'off', value: marca[clave] ?? '' });
    const primario = col('color_primario', t('admin.configuracion.colorPrimario'));
    const secundario = col('color_secundario', t('admin.configuracion.colorSecundario'));
    const acento = col('color_acento', t('admin.configuracion.colorAcento'));
    const logo = campo(t('admin.configuracion.logoUrl'), 'input', { name: 'logo_url', type: 'url', maxlength: '500', autocomplete: 'off', value: marca.logo_url ?? '' });

    const filasTurnos = h('div', { class: 'turnos' });
    const anadirTurno = (turno = { nombre: '', hora_inicio: '06:00', hora_fin: '18:00' }) => {
      const nombre = campo(t('admin.configuracion.turnoNombre'), 'input', { name: 'turno_nombre', maxlength: '60', value: turno.nombre });
      const ini = campo(t('admin.configuracion.turnoInicio'), 'input', { name: 'turno_inicio', type: 'time', value: turno.hora_inicio });
      const fin = campo(t('admin.configuracion.turnoFin'), 'input', { name: 'turno_fin', type: 'time', value: turno.hora_fin });
      const fila = h(
        'fieldset',
        { class: 'turno' },
        nombre.contenedor, ini.contenedor, fin.contenedor,
        h('button', { type: 'button', class: 'button-link button-link--danger', on: { click: () => fila.remove() } }, t('admin.configuracion.quitarTurno')),
      );
      fila.leer = () => ({ nombre: nombre.control.value, hora_inicio: ini.control.value, hora_fin: fin.control.value });
      filasTurnos.append(fila);
    };
    const existentes = Array.isArray(cfg.turnos) && cfg.turnos.length ? cfg.turnos.filter((x) => x && typeof x === 'object') : [];
    existentes.forEach((x) => anadirTurno({ nombre: x.nombre ?? '', hora_inicio: x.hora_inicio ?? '06:00', hora_fin: x.hora_fin ?? '18:00' }));

    const seleccion = new Set(Array.isArray(cfg.pruebas_activas) ? cfg.pruebas_activas : []);
    const checks = pruebas.map((p) => {
      const input = h('input', { type: 'checkbox', name: 'prueba', value: p.codigo, checked: seleccion.has(p.codigo) });
      return { input, nodo: h('label', { class: 'form-field form-field--check' }, input, p.nombre) };
    });
    const modalidad = campo(t('admin.configuracion.modalidad'), 'select', { name: 'baremo_modalidad' },
      MODALIDADES_BAREMO.map((m) => h('option', { value: m, selected: m === (cfg.baremo_modalidad ?? 'dinamico') }, t(`admin.configuracion.modalidades.${m}`))));

    const guardar = h('button', { type: 'submit', class: 'button-primary' }, t('admin.configuracion.guardar'));
    const form = h(
      'form',
      { novalidate: true, class: 'config-form', on: { submit: async (e) => {
        e.preventDefault();
        estado.limpiar();
        guardar.disabled = true;
        try {
          const nuevaMarca = { color_primario: primario.control.value, color_secundario: secundario.control.value, color_acento: acento.control.value, logo_url: logo.control.value };
          // Tipografías no editables aquí: se conservan.
          for (const k of ['tipografia_display', 'tipografia_base']) if (marca[k]) nuevaMarca[k] = marca[k];
          await servicio.guardarGeneral({
            empresaId,
            usuarioId: contexto.usuarioId(),
            marca: nuevaMarca,
            turnos: [...filasTurnos.children].map((f) => f.leer()),
            pruebasActivas: checks.filter((c) => c.input.checked).map((c) => c.input.value),
            baremoModalidad: modalidad.control.value,
          });
          applyBrandTokens(marcaATokens(await db.empresas.obtenerConfiguracion(empresaId).then((c) => c?.marca)));
          estado.ok(t('admin.guardado'));
        } catch (error) {
          estado.error(error);
        } finally {
          guardar.disabled = false;
        }
      } } },
      h('h2', {}, t('admin.configuracion.general')),
      h('h3', {}, t('admin.configuracion.marca')),
      primario.contenedor, secundario.contenedor, acento.contenedor, logo.contenedor,
      h('h3', {}, t('admin.configuracion.turnos')),
      filasTurnos,
      h('button', { type: 'button', class: 'button-secondary', on: { click: () => anadirTurno() } }, t('admin.configuracion.agregarTurno')),
      h('h3', {}, t('admin.configuracion.pruebasActivas')),
      h('p', { class: 'dialog__description' }, t('admin.configuracion.pruebasAyuda')),
      checks.map((c) => c.nodo),
      modalidad.contenedor,
      guardar,
      estado.nodo,
    );
    return form;
  }

  // ------------------------------------------------------------------- pesos
  function seccionPesos() {
    const estado = crearEstado();
    const actuales = icoVigente?.pesos ?? {};
    const campos = pruebas.map((p) => ({ codigo: p.codigo, ...campo(p.nombre, 'input', { name: `peso_${p.codigo}`, type: 'number', min: '0', step: 'any', value: String(actuales[p.codigo] ?? 1) }) }));
    const guardar = h('button', { type: 'submit', class: 'button-primary' }, t('admin.configuracion.guardarPesos'));
    return h(
      'form',
      { novalidate: true, class: 'config-form', on: { submit: async (e) => {
        e.preventDefault();
        estado.limpiar();
        guardar.disabled = true;
        try {
          const pesos = Object.fromEntries(campos.map((c) => [c.codigo, numeroOVacio(c.control)]));
          await servicio.publicarPesos({ empresaId, pesos });
          estado.ok(t('admin.guardado'));
        } catch (error) {
          estado.error(error);
        } finally {
          guardar.disabled = false;
        }
      } } },
      h('h2', {}, t('admin.configuracion.ico')),
      h('h3', {}, t('admin.configuracion.pesos')),
      h('p', { class: 'dialog__description' }, t('admin.configuracion.pesosAyuda')),
      icoVigente ? h('p', {}, t('admin.configuracion.versionVigente', { fecha: new Date(icoVigente.vigente_desde).toLocaleDateString('es-CO') })) : h('p', {}, t('admin.configuracion.sinVersion')),
      campos.map((c) => c.contenedor),
      guardar,
      estado.nodo,
    );
  }

  // ------------------------------------------------------------------ baremo
  function seccionBaremo() {
    const estado = crearEstado();
    const p = baremoVigente?.parametros ?? {};
    const modalidad = campo(t('admin.configuracion.modalidad'), 'select', { name: 'modalidad_baremo' }, ['institucional', 'dinamico'].map((m) =>
      h('option', { value: m, selected: m === (baremoVigente?.modalidad ?? 'institucional') }, t(`admin.configuracion.modalidades.${m}`))));
    const excelente = campo(t('admin.configuracion.umbralExcelente'), 'input', { name: 'excelente', type: 'number', min: '0', max: '100', step: 'any', value: String(p.umbrales?.excelente ?? 75) });
    const atencion = campo(t('admin.configuracion.umbralAtencion'), 'input', { name: 'atencion', type: 'number', min: '0', max: '100', step: 'any', value: String(p.umbrales?.atencion ?? 50) });
    const ventana = campo(t('admin.configuracion.ventana'), 'input', { name: 'ventana_dias', type: 'number', min: '1', max: '730', step: '1', value: String(p.ventana_dias ?? 90) });
    const minimo = campo(t('admin.configuracion.minimo'), 'input', { name: 'minimo_registros', type: 'number', min: '2', step: '1', value: String(p.minimo_registros ?? 30) });
    const bloqueInst = h('div', {}, excelente.contenedor, atencion.contenedor);
    const bloqueDin = h('div', {}, ventana.contenedor, minimo.contenedor);
    const alternar = () => {
      const inst = modalidad.control.value === 'institucional';
      bloqueInst.hidden = !inst;
      bloqueDin.hidden = inst;
    };
    modalidad.control.addEventListener('change', alternar);
    alternar();
    const guardar = h('button', { type: 'submit', class: 'button-primary' }, t('admin.configuracion.guardarBaremo'));
    return h(
      'form',
      { novalidate: true, class: 'config-form', on: { submit: async (e) => {
        e.preventDefault();
        estado.limpiar();
        guardar.disabled = true;
        try {
          await servicio.publicarBaremoIco({
            empresaId,
            modalidad: modalidad.control.value,
            excelente: numeroOVacio(excelente.control),
            atencion: numeroOVacio(atencion.control),
            ventanaDias: numeroOVacio(ventana.control),
            minimoRegistros: numeroOVacio(minimo.control),
          });
          estado.ok(t('admin.guardado'));
        } catch (error) {
          estado.error(error);
        } finally {
          guardar.disabled = false;
        }
      } } },
      h('h3', {}, t('admin.configuracion.baremo')),
      baremoVigente ? h('p', {}, t('admin.configuracion.versionVigente', { fecha: new Date(baremoVigente.vigente_desde).toLocaleDateString('es-CO') })) : h('p', {}, t('admin.configuracion.sinVersion')),
      modalidad.contenedor, bloqueInst, bloqueDin,
      h('p', { class: 'dialog__description' }, t('admin.configuracion.baremoCientifico')),
      guardar,
      estado.nodo,
    );
  }
}

export default { registrarRutaConfiguracion, RUTA_CONFIGURACION };
