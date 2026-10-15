/**
 * @module js/company-context
 * @description Contexto de la empresa activa: al cambiar `empresaActualId`
 * carga su configuración y aplica su marca (Fase 2 §3); al cerrar sesión
 * restaura la marca de la plataforma (escenario kiosco: otra empresa puede
 * iniciar sesión en el mismo dispositivo).
 *
 * La marca pasa por `brand.js` (lista blanca) antes de llegar al DOM.
 */

import { createLogger } from '../services/logger.js';
import { applyBrandTokens, resetToDefaultTokens } from './theming.js';
import { marcaATokens } from './brand.js';

const logger = createLogger('company-context');

/**
 * @param {{
 *   authService: import('../services/auth-service.js').AuthService,
 *   obtenerConfiguracion: (empresaId: string) => Promise<{marca?: object} | null>,
 *   onEmpresaCambiada?: () => void,
 * }} dependencias
 * @returns {() => void} Función para desmontar.
 */
export function initCompanyContext({ authService, obtenerConfiguracion, onEmpresaCambiada = () => {} }) {
  let secuencia = 0;
  let empresaAplicada = null;

  const sincronizar = async () => {
    const { estado, empresaActualId } = authService.sessionStore.getState();
    const empresaId = estado === 'autenticado' ? empresaActualId : null;
    if (empresaId === empresaAplicada) return;

    const anterior = empresaAplicada;
    empresaAplicada = empresaId;
    const mia = ++secuencia;

    // Siempre se parte de la marca de plataforma: applyBrandTokens hace merge y
    // una empresa sin color propio no debe heredar el de la anterior.
    resetToDefaultTokens();
    if (!empresaId) return;

    try {
      const configuracion = await obtenerConfiguracion(empresaId);
      if (mia !== secuencia) return; // llegó otra empresa mientras tanto
      applyBrandTokens(marcaATokens(configuracion?.marca), { empresaId });
    } catch (error) {
      // Sin marca propia la app sigue usable con la de plataforma.
      logger.warn('No se pudo cargar la marca de la empresa', { error: String(error) });
    }
    if (anterior) onEmpresaCambiada();
  };

  const desuscribir = authService.sessionStore.subscribe(() => {
    sincronizar();
  });
  sincronizar();
  return desuscribir;
}

export default { initCompanyContext };
