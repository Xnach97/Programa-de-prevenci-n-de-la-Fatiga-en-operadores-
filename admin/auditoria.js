/**
 * @module admin/auditoria
 * @description Consulta del registro de auditoría (solo lectura). Ruta
 * `/admin/auditoria`, permiso `auditoria.ver`. El detalle se muestra como texto
 * (JSON) — nunca como HTML.
 */

import { h } from '../js/ui/dom.js';
import { pager } from '../js/ui/pager.js';
import { mensajeSeguro } from '../js/ui/errors.js';
import { getDatabase } from '../js/database.js';
import { AuditService } from '../services/audit.js';
import { TAMANO_PAGINA_AUDITORIA } from '../js/repositories/audit-repository.js';
import { PERMISOS } from '../services/permissions-catalog.js';
import { t } from '../js/i18n.js';

export const RUTA_AUDITORIA = '/admin/auditoria';

export function registrarRutaAuditoria(router, contexto) {
  router.registerRoute(RUTA_AUDITORIA, {
    title: () => `${t('admin.auditoria.title')} · ${t('core.appName')}`,
    render: (contenedor) => renderAuditoria(contenedor, contexto),
    meta: { permiso: PERMISOS.AUDITORIA_VER, menu: { etiqueta: 'admin.menu.auditoria', orden: 50 } },
  });
}

const json = (v) => (v === null || v === undefined ? '—' : JSON.stringify(v, null, 2));

async function renderAuditoria(contenedor, contexto) {
  const empresaId = contexto.empresaActualId();
  if (!empresaId) {
    contenedor.append(h('p', { class: 'form-error', role: 'alert' }, t('organization.sinEmpresa')));
    return;
  }
  const servicio = new AuditService({ auditoria: (await getDatabase()).auditoria });
  const resultados = h('div', { 'aria-live': 'polite' });
  contenedor.append(h('section', { class: 'org-view' }, h('h1', {}, t('admin.auditoria.title')), resultados));
  let pagina = 0;

  async function cargar() {
    resultados.replaceChildren(h('p', { role: 'status' }, t('common.loading')));
    try {
      const { filas, total } = await servicio.listar(empresaId, { pagina });
      if (!resultados.isConnected) return;
      if (filas.length === 0) {
        resultados.replaceChildren(h('p', { class: 'table__empty' }, t('admin.auditoria.vacio')));
        return;
      }
      resultados.replaceChildren(
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, ...['fecha', 'accion', 'entidad', 'detalle'].map((k) => h('th', { scope: 'col' }, t(`admin.auditoria.${k}`))))),
          h(
            'tbody',
            {},
            filas.map((f) =>
              h(
                'tr',
                {},
                h('td', {}, new Date(f.created_at).toLocaleString('es-CO')),
                h('td', {}, f.accion),
                h('td', {}, f.entidad),
                h(
                  'td',
                  {},
                  h(
                    'details',
                    {},
                    h('summary', {}, t('admin.auditoria.detalle')),
                    h('p', {}, `${t('admin.auditoria.ip')}: ${f.ip ?? '—'}`),
                    h('p', {}, t('admin.auditoria.anterior')),
                    h('pre', { class: 'audit-json' }, json(f.detalle_anterior)),
                    h('p', {}, t('admin.auditoria.nuevo')),
                    h('pre', { class: 'audit-json' }, json(f.detalle_nuevo)),
                  ),
                ),
              ),
            ),
          ),
        ),
        pager({ pagina, total, tamano: TAMANO_PAGINA_AUDITORIA, etiqueta: 'admin.auditoria.paginaDe', onIr: (p) => { pagina = p; cargar(); } }),
      );
    } catch (error) {
      resultados.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, mensajeSeguro(error)));
    }
  }
  await cargar();
}

export default { registrarRutaAuditoria, RUTA_AUDITORIA };
