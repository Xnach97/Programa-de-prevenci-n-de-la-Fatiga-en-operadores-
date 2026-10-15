/**
 * @module dashboard/views
 * @description Cuatro dashboards (Fase 3 §10) como rutas del router:
 *  /dashboard/operativo · /dashboard/clinico · /dashboard/ejecutivo · /dashboard/cientifico
 * Todos comparten un selector de fecha (por defecto hoy, hora de Colombia).
 * El científico exige además la bandera `dashboard_cientifico` de la empresa.
 * Todo dato se pinta con `h()` o nodos SVG de texto: sin `innerHTML`.
 */

import { h } from '../js/ui/dom.js';
import { campo } from '../js/ui/forms.js';
import { mensajeSeguro } from '../js/ui/errors.js';
import { getDatabase } from '../js/database.js';
import { DashboardService } from './dashboard-service.js';
import { graficaLineas, graficaBarras, graficaRadar, graficaHistograma } from './charts.js';
import { AuditService, ACCIONES } from '../services/audit.js';
import { fechaLocal } from '../statistics/indicadores.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from '../js/i18n.js';

export const RUTAS_DASHBOARD = Object.freeze({
  operativo: '/dashboard/operativo',
  clinico: '/dashboard/clinico',
  ejecutivo: '/dashboard/ejecutivo',
  cientifico: '/dashboard/cientifico',
});

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v === null || v === undefined ? '—' : String(v));

const kpi = (etiqueta, valor) => h('div', { class: 'kpi' }, h('span', { class: 'kpi__valor' }, num(valor)), h('span', { class: 'kpi__etiqueta' }, etiqueta));

async function crearServicio(contexto) {
  const db = await getDatabase();
  const verNombres = contexto.tienePermiso(PERMISOS.OPERADORES_VER);
  return {
    db,
    servicio: new DashboardService({ indicadores: db.indicadores, reglas: db.reglas, operadores: verNombres ? db.operadores : null, catalogos: db.catalogos }),
  };
}

/**
 * Estructura común: título, selector de fecha, zona de resultados. `pintar(zona, dia)`
 * se vuelve a llamar al cambiar la fecha; las respuestas obsoletas se descartan.
 */
function esqueleto(contenedor, clave, pintar, extras = []) {
  const selector = campo(t('dashboard.fecha'), 'input', { type: 'date', name: 'fecha', value: fechaLocal(new Date()), max: fechaLocal(new Date()) });
  const zona = h('div', { class: 'dashboard__zona', 'aria-live': 'polite' });
  contenedor.append(h('section', { class: 'org-view dashboard' }, h('h1', {}, t(`dashboard.${clave}.title`)), h('div', { class: 'toolbar' }, selector.contenedor, ...extras), zona));
  let secuencia = 0;
  const cargar = async () => {
    const mia = ++secuencia;
    const dia = selector.control.value;
    if (!FECHA.test(dia)) {
      zona.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, t('dashboard.fechaInvalida')));
      return;
    }
    zona.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const nodos = await pintar(dia);
      if (mia === secuencia && zona.isConnected) zona.replaceChildren(...nodos);
    } catch (error) {
      if (mia === secuencia && zona.isConnected) zona.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    }
  };
  selector.control.addEventListener('change', cargar);
  return { cargar, selector, zona };
}

function sinEmpresa(contenedor) {
  contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
}

// ----------------------------------------------------------------- operativo
async function renderOperativo(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) return sinEmpresa(contenedor);
  const { servicio } = await crearServicio(contexto);
  const vista = esqueleto(contenedor, 'operativo', async (dia) => {
    const d = await servicio.operativo(empresaId, dia);
    const vacio = d.kpis.evaluados === 0;
    return [
      h('div', { class: 'kpis' }, kpi(t('dashboard.kpi.evaluados'), d.kpis.evaluados), kpi(t('dashboard.kpi.icoPromedio'), d.kpis.icoPromedio), kpi(t('dashboard.kpi.enRiesgo'), d.kpis.enRiesgo), kpi(t('dashboard.kpi.alertas'), d.kpis.alertasAbiertas)),
      vacio ? h('p', { class: 'table__empty' }, t('dashboard.sinDatosDia')) : null,
      d.porArea.length ? graficaBarras({ titulo: t('dashboard.operativo.icoPorArea'), aria: t('dashboard.operativo.icoPorAreaAria'), items: d.porArea }) : null,
      vacio
        ? null
        : h(
            'table',
            { class: 'table' },
            h('caption', {}, t('dashboard.operativo.operadoresDelDia')),
            h('thead', {}, h('tr', {}, ['operador', 'ico', 'riesgo', 'fatiga'].map((k) => h('th', { scope: 'col' }, t(`dashboard.operativo.col.${k}`))))),
            h('tbody', {}, d.operadores.map((o) => h('tr', {}, h('td', {}, o.etiqueta), h('td', {}, num(o.ico)), h('td', {}, num(o.riesgo)), h('td', {}, num(o.fatiga))))),
          ),
    ].filter(Boolean);
  });
  await vista.cargar();
}

// ------------------------------------------------------------------- clínico
async function renderClinico(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) return sinEmpresa(contenedor);
  const { servicio } = await crearServicio(contexto);
  const selectorOp = campo(t('dashboard.clinico.operador'), 'select', { name: 'operador' });
  let operadores = [];
  const refrescarLista = async (dia) => {
    operadores = await servicio.operadoresDelDia(empresaId, dia);
    const actual = selectorOp.control.value;
    selectorOp.control.replaceChildren(
      h('option', { value: '' }, t('dashboard.clinico.elegir')),
      ...operadores.map((o) => h('option', { value: o.id, selected: o.id === actual }, o.etiqueta)),
    );
  };
  const vista = esqueleto(
    contenedor,
    'clinico',
    async (dia) => {
      await refrescarLista(dia);
      const id = selectorOp.control.value;
      if (!id) return [h('p', { class: 'table__empty' }, operadores.length ? t('dashboard.clinico.elegirAyuda') : t('dashboard.sinDatosDia'))];
      return pintarClinico(await servicio.clinico(empresaId, id, dia));
    },
    [selectorOp.contenedor],
  );
  selectorOp.control.addEventListener('change', vista.cargar);
  await vista.cargar();
}

function pintarClinico(d) {
  const dias = d.serie.map((p) => p.dia);
  return [
    h('h2', {}, d.etiqueta),
    h('div', { class: 'kpis' }, kpi(t('dashboard.clinico.fatiga'), d.fatiga === null ? null : Math.round(d.fatiga * 10) / 10), kpi(t('dashboard.clinico.riesgo'), d.riesgo === null ? null : Math.round(d.riesgo * 10) / 10), kpi(t('dashboard.kpi.alertas'), d.alertasAbiertas)),
    graficaLineas({
      titulo: t('dashboard.clinico.evolucion'),
      aria: t('dashboard.clinico.evolucionAria'),
      dias,
      series: [
        { nombre: t('dashboard.clinico.ico'), valores: d.serie.map((p) => p.valor) },
        { nombre: t('dashboard.clinico.movil'), valores: d.serie.map((p) => p.movil), estilo: 'punteada' },
      ],
    }),
    graficaRadar({ titulo: t('dashboard.clinico.radar'), aria: t('dashboard.clinico.radarAria'), ejes: d.radar.map((r) => ({ etiqueta: t(`dashboard.categorias.${r.clave}`), valor: r.valor })) }),
    h('h3', {}, t('dashboard.clinico.recomendaciones')),
    d.recomendaciones.length ? h('ul', { class: 'recomendaciones' }, d.recomendaciones.map((r) => h('li', {}, r.texto_resuelto))) : h('p', { class: 'table__empty' }, t('dashboard.clinico.sinRecomendaciones')),
  ];
}

// ----------------------------------------------------------------- ejecutivo
async function renderEjecutivo(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) return sinEmpresa(contenedor);
  const { servicio } = await crearServicio(contexto);
  const vista = esqueleto(contenedor, 'ejecutivo', async (dia) => {
    const d = await servicio.ejecutivo(empresaId, dia);
    return [
      h('div', { class: 'kpis' }, kpi(t('dashboard.kpi.ico'), d.kpis.ico), kpi(t('dashboard.kpi.fatiga'), d.kpis.fatiga), kpi(t('dashboard.kpi.riesgo'), d.kpis.riesgo), kpi(t('dashboard.kpi.alertas'), d.kpis.alertasAbiertas)),
      graficaLineas({ titulo: t('dashboard.ejecutivo.tendencia'), aria: t('dashboard.ejecutivo.tendenciaAria'), dias: d.tendencia.map((p) => p.dia), series: [{ nombre: t('dashboard.kpi.ico'), valores: d.tendencia.map((p) => p.valor) }] }),
      d.porArea.length ? graficaBarras({ titulo: t('dashboard.ejecutivo.porArea'), aria: t('dashboard.ejecutivo.porAreaAria'), items: d.porArea }) : null,
      d.porCargo.length ? graficaBarras({ titulo: t('dashboard.ejecutivo.porCargo'), aria: t('dashboard.ejecutivo.porCargoAria'), items: d.porCargo }) : null,
    ].filter(Boolean);
  });
  await vista.cargar();
}

// ---------------------------------------------------------------- científico
async function renderCientifico(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) return sinEmpresa(contenedor);
  const { servicio, db } = await crearServicio(contexto);
  const cfg = await db.empresas.obtenerConfiguracion(empresaId);
  if (cfg?.feature_flags?.dashboard_cientifico !== true) {
    contenedor.append(h('section', { class: 'org-view' }, h('h1', {}, t('dashboard.cientifico.title')), h('p', { class: 'form-error', role: 'alert' }, t('dashboard.cientifico.desactivado'))));
    return;
  }
  const auditoria = new AuditService({ auditoria: db.auditoria });
  const vista = esqueleto(contenedor, 'cientifico', async (dia) => {
    await auditoria.registrarMejorEsfuerzo({ empresaId, accion: ACCIONES.DASHBOARD_CIENTIFICO_ACCEDER, entidad: 'dashboard_cientifico', detalle: { dia } });
    const d = await servicio.cientifico(empresaId, dia);
    if (d.n === 0) return [h('p', { class: 'table__empty' }, t('dashboard.sinDatosDia'))];
    const r = d.resumen;
    const f = (v) => (v === null ? '—' : String(Math.round(v * 100) / 100));
    return [
      h('p', { class: 'dialog__description' }, t('dashboard.cientifico.aviso')),
      h('div', { class: 'kpis' }, kpi('n', d.n), kpi(t('dashboard.cientifico.media'), f(r.media)), kpi(t('dashboard.cientifico.desviacion'), f(r.desviacion)), kpi(t('dashboard.cientifico.cv'), r.coeficienteVariacion === null ? null : `${f(r.coeficienteVariacion)}%`)),
      graficaHistograma({ titulo: t('dashboard.cientifico.distribucion'), aria: t('dashboard.cientifico.distribucionAria'), limites: d.histograma.limites, conteos: d.histograma.conteos, curva: d.curva }),
      h(
        'table',
        { class: 'table' },
        h('caption', {}, t('dashboard.cientifico.percentiles')),
        h('thead', {}, h('tr', {}, ['min', 'p25', 'mediana', 'p75', 'p90', 'max'].map((k) => h('th', { scope: 'col' }, k)))),
        h('tbody', {}, h('tr', {}, [r.minimo, r.p25, r.mediana, r.p75, r.p90, r.maximo].map((v) => h('td', {}, f(v))))),
      ),
      h('h3', {}, t('dashboard.cientifico.atipicos')),
      d.atipicos.length ? h('ul', {}, d.atipicos.map((a) => h('li', {}, `${a.etiqueta}: ${a.valor}`))) : h('p', { class: 'table__empty' }, t('dashboard.cientifico.sinAtipicos')),
    ];
  });
  await vista.cargar();
}

/** Registra las cuatro rutas. */
export function registrarRutasDashboard(router, contexto) {
  const ruta = (clave, render, permiso, orden) =>
    router.registerRoute(RUTAS_DASHBOARD[clave], {
      title: () => `${t(`dashboard.${clave}.title`)} · ${t('core.appName')}`,
      render: (contenedor) => render(contenedor, contexto),
      meta: { permiso, menu: { etiqueta: `dashboard.${clave}.menu`, orden } },
    });
  ruta('operativo', renderOperativo, PERMISOS.EVALUACIONES_VER, 6);
  ruta('clinico', renderClinico, PERMISOS.EVALUACIONES_VER, 7);
  ruta('ejecutivo', renderEjecutivo, PERMISOS.EVALUACIONES_VER, 7.5);
  ruta('cientifico', renderCientifico, PERMISOS.INVESTIGACION_ACCEDER, 9);
}

export default { registrarRutasDashboard, RUTAS_DASHBOARD };
