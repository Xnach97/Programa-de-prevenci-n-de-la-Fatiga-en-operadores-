/**
 * @module services/audit
 * @description Auditoría de acciones SIN tabla propia (Fase 3 §12): exportaciones
 * de datasets, accesos al dashboard científico, etc. Los cambios en tablas
 * sensibles los registra la BD por trigger.
 *
 * `registrar` PROPAGA el error: para una exportación, si no puede auditarse,
 * no debe ejecutarse. Los accesos de solo lectura usan `registrarMejorEsfuerzo`.
 */

import { createLogger } from './logger.js';

const logger = createLogger('audit');

/** Acciones reconocidas (evita typos que dejarían huecos en el historial). */
export const ACCIONES = Object.freeze({
  DATASET_EXPORTAR: 'dataset.exportar',
  DASHBOARD_CIENTIFICO_ACCEDER: 'dashboard_cientifico.acceder',
  COHORTE_CREAR: 'cohorte.crear',
  CONSENTIMIENTO_REGISTRAR: 'consentimiento.registrar',
});

export class AuditService {
  /** @param {{auditoria: {registrar: Function, listar: Function}}} deps */
  constructor({ auditoria }) {
    if (!auditoria) throw new TypeError('AuditService requiere el repositorio de auditoría.');
    this._repo = auditoria;
  }

  /** @param {{empresaId: string, accion: string, entidad: string, entidadId?: string|null, detalle?: object|null}} evento */
  registrar(evento) {
    if (!Object.values(ACCIONES).includes(evento.accion)) throw new TypeError(`Acción de auditoría desconocida: "${evento.accion}".`);
    return this._repo.registrar(evento);
  }

  async registrarMejorEsfuerzo(evento) {
    try {
      return await this.registrar(evento);
    } catch (error) {
      logger.warn('No se pudo registrar la auditoría', { accion: evento?.accion, error: String(error) });
      return null;
    }
  }

  listar(empresaId, opciones) {
    return this._repo.listar(empresaId, opciones);
  }
}

export default { AuditService, ACCIONES };
