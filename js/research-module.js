/**
 * @module js/research-module
 * @description Registro del Módulo 10: ruta `/investigacion` con su guarda por permiso.
 */
import { requierePermiso } from './auth.js';
import { registrarRutaInvestigacion, RUTA_INVESTIGACION } from '../research/research-view.js';
import { PERMISOS } from '../services/permissions-catalog.js';

/** @param {{router: import('./navigation.js').router, authService: import('../services/auth-service.js').AuthService}} dependencias */
export function initResearchModule({ router, authService }) {
  registrarRutaInvestigacion(router, {
    tienePermiso: (codigo) => authService.tienePermiso(codigo),
    empresaActualId: () => authService.sessionStore.getState().empresaActualId,
    usuarioId: () => authService.sessionStore.getState().usuario?.id ?? null,
  });
  router.addGuard(requierePermiso(PERMISOS.INVESTIGACION_ACCEDER, RUTA_INVESTIGACION));
}

export default { initResearchModule };
