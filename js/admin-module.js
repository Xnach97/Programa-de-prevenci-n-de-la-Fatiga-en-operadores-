/**
 * @module js/admin-module
 * @description Registro del Módulo 7: configuración de empresa, reglas, bandeja
 * de alertas y auditoría, cada una con su guarda por permiso.
 */
import { requierePermiso } from './auth.js';
import { registrarRutaConfiguracion, RUTA_CONFIGURACION } from '../admin/configuracion.js';
import { registrarRutaReglas, RUTA_REGLAS } from '../admin/reglas.js';
import { registrarRutaAuditoria, RUTA_AUDITORIA } from '../admin/auditoria.js';
import { registrarRutaAlertas, RUTA_ALERTAS } from './alerts.js';
import { PERMISOS } from '../services/permissions-catalog.js';

/** @param {{router: import('./navigation.js').router, authService: import('../services/auth-service.js').AuthService}} dependencias */
export function initAdminModule({ router, authService }) {
  const contexto = {
    tienePermiso: (codigo) => authService.tienePermiso(codigo),
    empresaActualId: () => authService.sessionStore.getState().empresaActualId,
    usuarioId: () => authService.sessionStore.getState().usuario?.id ?? null,
  };
  registrarRutaConfiguracion(router, contexto);
  registrarRutaReglas(router, contexto);
  registrarRutaAuditoria(router, contexto);
  registrarRutaAlertas(router, contexto);
  router.addGuard(requierePermiso(PERMISOS.CONFIGURACION_EDITAR, RUTA_CONFIGURACION));
  router.addGuard(requierePermiso(PERMISOS.CONFIGURACION_EDITAR, RUTA_REGLAS));
  router.addGuard(requierePermiso(PERMISOS.AUDITORIA_VER, RUTA_AUDITORIA));
  router.addGuard(requierePermiso(PERMISOS.EVALUACIONES_VER, RUTA_ALERTAS));
}

export default { initAdminModule };
