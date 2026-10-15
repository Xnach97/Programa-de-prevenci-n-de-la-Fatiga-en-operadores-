/**
 * @module js/organization
 * @description Punto de entrada del módulo Organization (Módulo 3).
 * Registra las rutas de catálogos y operadores con sus guardas por permiso,
 * monta el menú principal y el contexto de empresa (marca).
 */

import { getDatabase } from './database.js';
import { requierePermiso } from './auth.js';
import { registrarRutaCatalogos, RUTA_CATALOGOS } from '../admin/catalogos.js';
import { registrarRutaOperadores, RUTA_OPERADORES } from './operator.js';
import { montarMenu } from './menu.js';
import { initCompanyContext } from './company-context.js';
import { PERMISOS } from '../services/permissions-catalog.js';

/**
 * @param {{router: import('./navigation.js').router, authService: import('../services/auth-service.js').AuthService}} dependencias
 */
export function initOrganizationModule({ router, authService }) {
  const contexto = {
    tienePermiso: (codigo) => authService.tienePermiso(codigo),
    empresaActualId: () => authService.sessionStore.getState().empresaActualId,
  };

  registrarRutaOperadores(router, contexto);
  registrarRutaCatalogos(router, contexto);

  router.addGuard(requierePermiso(PERMISOS.OPERADORES_VER, RUTA_OPERADORES));
  router.addGuard(requierePermiso(PERMISOS.CATALOGOS_VER, RUTA_CATALOGOS));

  montarMenu({ router, authService });
  initCompanyContext({
    authService,
    obtenerConfiguracion: async (empresaId) => (await getDatabase()).empresas.obtenerConfiguracion(empresaId),
    onEmpresaCambiada: () => router.refresh(),
  });
}

export default { initOrganizationModule };
