/**
 * @module research/research-service
 * @description Casos de uso de la plataforma de investigación. Valida entradas y
 * traduce los errores de la BD (mínimo de participantes, permisos) a mensajes
 * redactados para el usuario. La anonimización y la auditoría las impone la BD.
 */

import { aCsv, COLUMNAS_DATASET } from './csv.js';

export class ResearchError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ResearchError';
    this.codigo = 'validacion'; // `mensajeSeguro` solo muestra el texto de errores con este código
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOMBRE_COHORTE_MAX = 120;

export class ResearchService {
  /** @param {{research: import('../js/repositories/research-repository.js').ResearchRepository, ahora?: () => Date}} deps */
  constructor({ research, ahora = () => new Date() }) {
    if (!research) throw new TypeError('ResearchService requiere el repositorio de investigación.');
    this._repo = research;
    this._ahora = ahora;
  }

  listarCohortes(empresaId) {
    return this._repo.listarCohortes(empresaId);
  }

  /** @param {{empresaId: string, nombre: string, areaId?: string|null, cargoId?: string|null}} datos */
  async crearCohorte({ empresaId, nombre, areaId = null, cargoId = null }) {
    const limpio = typeof nombre === 'string' ? nombre.replace(/\s+/g, ' ').trim() : '';
    if (!limpio) throw new ResearchError('El nombre de la cohorte es obligatorio.');
    if (limpio.length > NOMBRE_COHORTE_MAX) throw new ResearchError(`El nombre no puede superar ${NOMBRE_COHORTE_MAX} caracteres.`);
    const criterio = {};
    for (const [k, v] of [['area_id', areaId], ['cargo_id', cargoId]]) {
      if (v) {
        if (!UUID.test(v)) throw new ResearchError('El criterio de inclusión es inválido.');
        criterio[k] = v;
      }
    }
    return this._traducir(() => this._repo.crearCohorte({ empresaId, nombre: limpio, criterio: Object.keys(criterio).length ? criterio : null }));
  }

  eliminarCohorte(cohorteId) {
    return this._traducir(() => this._repo.eliminarCohorte(cohorteId));
  }

  poblarCohorte(cohorteId) {
    return this._traducir(() => this._repo.poblarCohorte(cohorteId));
  }

  consentimientos(empresaId, operadorIds) {
    return this._repo.consentimientosInvestigacion(empresaId, operadorIds);
  }

  /** Otorgar o revocar (la revocación saca al operador de todas las cohortes en la BD). */
  async registrarConsentimiento({ empresaId, operadorId, otorgado, documentoUrl = null }) {
    if (documentoUrl !== null && documentoUrl !== '' && !/^https:\/\/\S+$/i.test(documentoUrl)) throw new ResearchError('El enlace del documento debe empezar por https://');
    return this._traducir(() => this._repo.registrarConsentimiento({ empresaId, operadorId, otorgado, documentoUrl: documentoUrl || null }));
  }

  /**
   * @returns {Promise<{csv: string, nombreArchivo: string, participantes: number, filas: number, datasetId: string}>}
   */
  async exportarCsv({ empresaId, cohorteId, desde = null, hasta = null }) {
    if (desde && hasta && hasta < desde) throw new ResearchError('La fecha final no puede ser anterior a la inicial.');
    const r = await this._traducir(() => this._repo.exportarDataset({ empresaId, cohorteId, desde: desde || null, hasta: hasta || null }));
    const sello = this._ahora().toISOString().slice(0, 10);
    return {
      csv: aCsv(r.filas ?? [], COLUMNAS_DATASET),
      nombreArchivo: `neurolab-dataset-${sello}-${r.dataset_id.slice(0, 8)}.csv`,
      participantes: r.participantes,
      filas: (r.filas ?? []).length,
      datasetId: r.dataset_id,
    };
  }

  async _traducir(operacion) {
    try {
      return await operacion();
    } catch (error) {
      const causa = error?.causaOriginal;
      const msg = String(causa?.message ?? '');
      if (causa?.code === '23514' && /mínimo/i.test(msg)) throw new ResearchError('La cohorte no alcanza el mínimo de 5 participantes con consentimiento vigente; no se puede exportar de forma anónima.');
      if (causa?.code === '23514' && /consentimiento/i.test(msg)) throw new ResearchError('El operador no tiene consentimiento vigente para investigación.');
      if (causa?.code === '23505') throw new ResearchError('Ya existe una cohorte con ese nombre.');
      if (causa?.code === '54000') throw new ResearchError('El dataset es demasiado grande; acote el rango de fechas.');
      throw error;
    }
  }
}

export default { ResearchService, ResearchError };
