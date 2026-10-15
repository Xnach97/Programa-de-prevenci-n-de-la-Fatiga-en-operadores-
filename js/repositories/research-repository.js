/**
 * @module js/repositories/research-repository
 * @description Acceso a cohortes, consentimientos y exportación anonimizada. La
 * exportación pasa SIEMPRE por la RPC `exportar_dataset` (permisos, mínimo de
 * participantes, pseudónimos y rastro de auditoría se imponen en la BD).
 */

import { RepositoryError } from './repository-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const exigirUuid = (v, n) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new TypeError(`${n} debe ser un UUID.`);
  return v;
};

export class ResearchRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('ResearchRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
  }

  /** @returns {Promise<Array<{id: string, nombre: string, criterio: object|null, created_at: string, miembros: number}>>} */
  async listarCohortes(empresaId) {
    const id = exigirUuid(empresaId, 'empresaId');
    const { data, error } = await this._client.from('cohortes').select('id, nombre, criterio, created_at').eq('empresa_id', id).order('created_at', { ascending: false }).limit(200);
    if (error) throw new RepositoryError('cohortes.listar', error);
    const cohortes = data ?? [];
    if (cohortes.length === 0) return [];
    const { data: miembros, error: e2 } = await this._client.from('cohortes_operadores').select('cohorte_id').eq('empresa_id', id).in('cohorte_id', cohortes.map((c) => c.id)).limit(20000);
    if (e2) throw new RepositoryError('cohortes.miembros', e2);
    const conteo = new Map();
    for (const m of miembros ?? []) conteo.set(m.cohorte_id, (conteo.get(m.cohorte_id) ?? 0) + 1);
    return cohortes.map((c) => ({ ...c, miembros: conteo.get(c.id) ?? 0 }));
  }

  async crearCohorte({ empresaId, nombre, criterio = null }) {
    const { data, error } = await this._client.from('cohortes').insert({ empresa_id: exigirUuid(empresaId, 'empresaId'), nombre, criterio }).select('id, nombre, criterio, created_at').single();
    if (error) throw new RepositoryError('cohortes.crear', error);
    return data;
  }

  async eliminarCohorte(cohorteId) {
    const { error } = await this._client.from('cohortes').delete().eq('id', exigirUuid(cohorteId, 'cohorteId'));
    if (error) throw new RepositoryError('cohortes.eliminar', error);
  }

  /** @returns {Promise<number>} Operadores incorporados. */
  async poblarCohorte(cohorteId) {
    const { data, error } = await this._client.rpc('poblar_cohorte', { p_cohorte: exigirUuid(cohorteId, 'cohorteId') });
    if (error) throw new RepositoryError('cohortes.poblar', error);
    return data;
  }

  /**
   * Consentimiento VIGENTE (el registro más reciente) de investigación por operador.
   * @returns {Promise<Map<string, boolean>>} operadorId → otorgado (ausente = sin registro)
   */
  async consentimientosInvestigacion(empresaId, operadorIds) {
    const id = exigirUuid(empresaId, 'empresaId');
    const ids = operadorIds.map((o) => exigirUuid(o, 'operadorId'));
    if (ids.length === 0) return new Map();
    const { data, error } = await this._client
      .from('consentimientos')
      .select('operador_id, otorgado, fecha')
      .eq('empresa_id', id)
      .eq('proposito', 'investigacion_cientifica')
      .in('operador_id', ids)
      .order('fecha', { ascending: false })
      .limit(5000);
    if (error) throw new RepositoryError('consentimientos.listar', error);
    const vigente = new Map();
    for (const f of data ?? []) if (!vigente.has(f.operador_id)) vigente.set(f.operador_id, f.otorgado === true); // la lista viene del más reciente al más antiguo
    return vigente;
  }

  async registrarConsentimiento({ empresaId, operadorId, otorgado, documentoUrl = null }) {
    const { error } = await this._client.from('consentimientos').insert({
      empresa_id: exigirUuid(empresaId, 'empresaId'),
      operador_id: exigirUuid(operadorId, 'operadorId'),
      proposito: 'investigacion_cientifica',
      otorgado: otorgado === true,
      documento_url: documentoUrl,
    });
    if (error) throw new RepositoryError('consentimientos.registrar', error);
  }

  /** @returns {Promise<{dataset_id: string, participantes: number, filas: object[]}>} */
  async exportarDataset({ empresaId, cohorteId, desde = null, hasta = null }) {
    for (const [v, n] of [[desde, 'desde'], [hasta, 'hasta']]) if (v !== null && !FECHA.test(v)) throw new TypeError(`${n} debe ser YYYY-MM-DD.`);
    const { data, error } = await this._client.rpc('exportar_dataset', {
      p_empresa: exigirUuid(empresaId, 'empresaId'),
      p_cohorte: exigirUuid(cohorteId, 'cohorteId'),
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new RepositoryError('datasets.exportar', error);
    return data;
  }
}

export default ResearchRepository;
