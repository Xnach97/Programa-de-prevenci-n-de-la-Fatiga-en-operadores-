/**
 * @module js/evaluation-module
 * @description Registro del módulo Testing Engine: ruta `/evaluacion` y su guarda.
 */
import { requierePermiso } from './auth.js';
import { registrarRutaEvaluacion, RUTA_EVALUACION } from './evaluation.js';
import { PERMISOS } from '../services/permissions-catalog.js';

/** @param {{router: import('./navigation.js').router, authService: import('../services/auth-service.js').AuthService}} dependencias */
export function initEvaluationModule({ router, authService }) {
  registrarRutaEvaluacion(router, {
    tienePermiso: (codigo) => authService.tienePermiso(codigo),
    empresaActualId: () => authService.sessionStore.getState().empresaActualId,
    usuarioId: () => authService.sessionStore.getState().usuario?.id ?? null,
  });
  router.addGuard(requierePermiso(PERMISOS.EVALUACIONES_REGISTRAR, RUTA_EVALUACION));
}

export default { initEvaluationModule };
