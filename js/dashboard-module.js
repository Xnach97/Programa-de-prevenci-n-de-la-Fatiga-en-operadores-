/**
 * @module js/dashboard-module
 * @description Registro del Módulo 8: cuatro dashboards con guarda por permiso.
 * El dashboard científico además exige la bandera de empresa (se valida en la vista).
 */
import { requierePermiso } from './auth.js';
import { registrarRutasDashboard, RUTAS_DASHBOARD } from '../dashboard/views.js';
import { PERMISOS } from '../services/permissions-catalog.js';

/** @param {{router: import('./navigation.js').router, authService: import('../services/auth-service.js').AuthService}} dependencias */
export function initDashboardModule({ router, authService }) {
  registrarRutasDashboard(router, {
    tienePermiso: (codigo) => authService.tienePermiso(codigo),
    empresaActualId: () => authService.sessionStore.getState().empresaActualId,
    usuarioId: () => authService.sessionStore.getState().usuario?.id ?? null,
  });
  for (const clave of ['operativo', 'clinico', 'ejecutivo']) router.addGuard(requierePermiso(PERMISOS.EVALUACIONES_VER, RUTAS_DASHBOARD[clave]));
  router.addGuard(requierePermiso(PERMISOS.INVESTIGACION_ACCEDER, RUTAS_DASHBOARD.cientifico));
}

export default { initDashboardModule };
