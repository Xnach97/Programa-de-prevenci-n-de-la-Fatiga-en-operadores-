/**
 * @module js/evaluation
 * @description Pantalla de evaluación cognitiva (Fase 2 §4). Ruta `/evaluacion`,
 * permiso `evaluaciones.registrar`.
 *
 * Flujo: selección de operador (el propio, o por cédula en modo quiosco) y turno
 * → por cada prueba activa: tutorial (1.ª vez) → ejecución → resultado con ICO y
 * clasificación → guardado atómico e idempotente (reintentable con el MISMO
 * payload sin duplicar).
 */

import { h } from './ui/dom.js';
import { campo } from './ui/forms.js';
import { getDatabase } from './database.js';
import { getScientificServices } from './scientific.js';
import { EvaluacionService, turnosDeEmpresa } from '../services/evaluacion-service.js';
import { testRegistry } from '../tests/index.js';
import { mostrarTutorial } from '../tests/tutorial.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { createLogger } from '../services/logger.js';
import { t } from './i18n.js';

export const RUTA_EVALUACION = '/evaluacion';
const logger = createLogger('evaluation');
const CLAVE_DISPOSITIVO = 'neurolab_sst:dispositivo';

/** Identificador estable del dispositivo (trazabilidad); sin almacenamiento, null. */
function dispositivoId() {
  try {
    let id = globalThis.localStorage?.getItem(CLAVE_DISPOSITIVO);
    if (!id) {
      id = crypto.randomUUID();
      globalThis.localStorage?.setItem(CLAVE_DISPOSITIVO, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** @type {Promise<{db: object, servicio: EvaluacionService}>|null} */
let dependenciasPromise = null;
function dependencias() {
  if (!dependenciasPromise) {
    dependenciasPromise = Promise.all([getDatabase(), getScientificServices()])
      .then(([db, { motor }]) => ({
        db,
        servicio: new EvaluacionService({ testing: db.testing, motor, registro: testRegistry, dispositivoId: dispositivoId() }),
      }))
      .catch((error) => {
        dependenciasPromise = null;
        throw error;
      });
  }
  return dependenciasPromise;
}

/**
 * @param {import('./navigation.js').router} router
 * @param {{tienePermiso: (c: string) => boolean, empresaActualId: () => string|null, usuarioId: () => string|null}} contexto
 */
export function registrarRutaEvaluacion(router, contexto) {
  router.registerRoute(RUTA_EVALUACION, {
    title: () => `${t('testing.titulo')} · ${t('core.appName')}`,
    render: (contenedor) => renderEvaluacion(contenedor, contexto),
    meta: { permiso: PERMISOS.EVALUACIONES_REGISTRAR, menu: { etiqueta: 'testing.menu', orden: 5 } },
  });
}

const mensajeError = (texto) => h('p', { class: 'form-error', role: 'alert' }, texto);

async function renderEvaluacion(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(mensajeError(t('organization.sinEmpresa')));
    return;
  }
  const raiz = h('section', { class: 'org-view' }, h('h1', {}, t('testing.titulo')));
  const escenario = h('div', { 'aria-live': 'polite' });
  raiz.append(escenario);
  contenedor.append(raiz);

  let ctx;
  let configuracion;
  let pruebas;
  let propio = null;
  try {
    ctx = await dependencias();
    configuracion = await ctx.db.empresas.obtenerConfiguracion(empresaId);
    pruebas = await ctx.servicio.cargarPruebas(configuracion);
    const usuarioId = contexto.usuarioId();
    propio = usuarioId ? await ctx.db.operadores.obtenerPorUsuario(usuarioId) : null;
  } catch (error) {
    logger.error('No se pudo preparar la evaluación', { error: String(error) });
    escenario.append(mensajeError(t('testing.errorGuardar')));
    return;
  }
  if (pruebas.length === 0) {
    escenario.append(mensajeError(t('testing.sinPruebas')));
    return;
  }

  mostrarSeleccion({ escenario, ctx, empresaId, configuracion, pruebas, propio });
}

function mostrarSeleccion({ escenario, ctx, empresaId, configuracion, pruebas, propio }) {
  let operador = propio;
  const mensaje = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const operadorInfo = h('p', { class: 'eval-operador', 'aria-live': 'polite' });
  const turnos = turnosDeEmpresa(configuracion);
  const turno = campo(t('testing.turno'), 'select', { name: 'turno' }, turnos.map((x) => h('option', { value: x }, x)));
  const comenzar = h(
    'button',
    { type: 'button', class: 'button-primary', disabled: !operador, on: { click: () => iniciar() } },
    t('testing.comenzar'),
  );

  const fijarOperador = (op) => {
    operador = op;
    operadorInfo.textContent = op ? `${t('testing.operador')}: ${op.nombre ?? ''} ${op.apellido ?? ''} (${op.cedula})` : '';
    comenzar.disabled = !op;
  };

  const bloques = [];
  if (propio) {
    fijarOperador(propio);
  } else {
    const cedula = campo(t('testing.cedula'), 'input', { name: 'cedula', maxlength: '40', autocomplete: 'off', inputmode: 'numeric' });
    const buscar = async () => {
      mensaje.hidden = true;
      try {
        const encontrado = await ctx.db.operadores.obtenerActivoPorCedula(empresaId, cedula.control.value);
        if (!encontrado) {
          mensaje.textContent = t('testing.noEncontrado');
          mensaje.hidden = false;
        }
        fijarOperador(encontrado);
      } catch (error) {
        logger.error('Búsqueda de operador falló', { error: String(error) });
        mensaje.textContent = t('testing.errorGuardar');
        mensaje.hidden = false;
      }
    };
    cedula.control.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        buscar();
      }
    });
    bloques.push(
      cedula.contenedor,
      h('button', { type: 'button', class: 'button-secondary', on: { click: buscar } }, t('testing.buscar')),
    );
  }

  escenario.replaceChildren(h('div', { class: 'test-panel' }, ...bloques, operadorInfo, turno.contenedor, mensaje, comenzar));

  async function iniciar() {
    if (!operador) return;
    comenzar.disabled = true;
    await correrEvaluacion({ escenario, ctx, empresaId, operador, turno: turno.control.value, pruebas, alTerminar: () => mostrarSeleccion({ escenario, ctx, empresaId, configuracion, pruebas, propio }) });
  }
}

async function correrEvaluacion({ escenario, ctx, empresaId, operador, turno, pruebas, alTerminar }) {
  const ejecuciones = [];
  try {
    for (const [i, entrada] of pruebas.entries()) {
      const { prueba, version, definicion } = entrada;
      const cabecera = h('p', { class: 'eval-progreso' }, t('testing.prueba', { actual: i + 1, total: pruebas.length }));
      const zona = h('div');
      escenario.replaceChildren(cabecera, zona);
      await mostrarTutorial(zona, { operadorId: operador.id, codigo: prueba.codigo, titulo: prueba.nombre, pasos: definicion.instrucciones });
      const resultado = await definicion.ejecutar(zona, { parametros: version.parametros });
      ejecuciones.push({ prueba, version, definicion, resultado });
    }
    const { payload, resumen } = await ctx.servicio.cerrar({ empresaId, operador, turno, ejecuciones });
    mostrarResultado({ escenario, ctx, payload, resumen, pruebas, alTerminar });
  } catch (error) {
    logger.error('La evaluación falló', { error: String(error) });
    escenario.replaceChildren(mensajeError(t('testing.errorGuardar')), h('button', { type: 'button', class: 'button-secondary', on: { click: alTerminar } }, t('testing.nueva')));
  }
}

function mostrarResultado({ escenario, ctx, payload, resumen, pruebas, alTerminar }) {
  const nombres = Object.fromEntries(pruebas.map((p) => [p.prueba.codigo, p.prueba.nombre]));
  const estado = h('p', { class: 'test-feedback', role: 'status', 'aria-live': 'polite' }, t('testing.guardando'));
  const reintentar = h('button', { type: 'button', class: 'button-secondary', hidden: true, on: { click: () => guardar() } }, t('testing.reintentar'));
  const nueva = h('button', { type: 'button', class: 'button-primary', hidden: true, on: { click: alTerminar } }, t('testing.nueva'));

  async function guardar() {
    reintentar.hidden = true;
    estado.textContent = t('testing.guardando');
    try {
      const r = await ctx.servicio.guardar(payload);
      estado.textContent = r?.encolada ? t('testing.pendiente') : t('testing.guardado');
      nueva.hidden = false;
    } catch (error) {
      logger.error('Guardado de evaluación falló', { error: String(error) });
      estado.textContent = t('testing.errorGuardar');
      reintentar.hidden = false;
    }
  }

  const filas = resumen.resultados.map((r) =>
    h('tr', {}, h('td', {}, nombres[r.codigo] ?? r.codigo), h('td', {}, r.puntaje_normalizado), h('td', {}, r.tiempo_total_ms === null ? '—' : `${r.tiempo_total_ms} ms`), h('td', {}, r.errores_totales)),
  );
  escenario.replaceChildren(
    h(
      'section',
      { class: 'test-panel eval-resumen' },
      h('h2', {}, t('testing.resultado.titulo')),
      resumen.ico === null
        ? h('p', {}, resumen.configuracionFaltante ? t('testing.resultado.sinConfiguracion') : t('testing.resultado.sinIco'))
        : h('p', {}, t('testing.resultado.ico'), ': ', h('span', { class: 'eval-resumen__ico' }, resumen.ico)),
      resumen.nivel ? h('p', {}, t('testing.resultado.nivel'), ': ', h('strong', { class: 'eval-nivel', dataset: { nivel: resumen.nivel } }, t(`testing.niveles.${resumen.nivel}`))) : null,
      h(
        'table',
        { class: 'eval-tabla' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('common.prueba')), h('th', { scope: 'col' }, t('testing.resultado.puntaje')), h('th', { scope: 'col' }, t('testing.resultado.tiempo')), h('th', { scope: 'col' }, t('testing.resultado.errores')))),
        h('tbody', {}, filas),
      ),
      h('p', { class: 'test-tutorial__aviso' }, t('testing.resultado.calibracion')),
      estado,
      reintentar,
      nueva,
    ),
  );
  guardar();
}

export default { registrarRutaEvaluacion, RUTA_EVALUACION };
