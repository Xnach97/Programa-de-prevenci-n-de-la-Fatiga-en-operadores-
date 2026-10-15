/**
 * @module js/repositories/rules-repository
 * @description Reglas, plantillas de recomendación, alertas y datos históricos
 * para los percentiles (Fase 3 §9). Alertas y recomendaciones se crean SOLO
 * con la función `publicar_resultado_reglas`.
 */

import { RepositoryError } from './repository-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exigirUuid = (v, n) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new TypeError(`${n} debe ser un UUID.`);
  return v;
};
export const TAMANO_PAGINA_ALERTAS = 25;
const COLUMNA_METRICA = Object.freeze({ tiempo: 'tiempo_total_ms', puntaje: 'puntaje_normalizado', errores: 'errores_totales' });
const COLUMNAS_REGLA = 'id, empresa_id, nombre, condicion, severidad, mensaje_plantilla, estado';

export class ReglasRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient */
  constructor(supabaseClient) {
    if (!supabaseClient) throw new TypeError('ReglasRepository requiere una instancia de cliente Supabase.');
    this._client = supabaseClient;
  }

  /** Reglas de la empresa MÁS las globales. @param {{soloActivas?: boolean}} [o] */
  async listarReglas(empresaId, { soloActivas = true } = {}) {
    const id = exigirUuid(empresaId, 'empresaId');
    let consulta = this._client.from('reglas').select(COLUMNAS_REGLA).or(`empresa_id.eq.${id},empresa_id.is.null`).order('nombre');
    if (soloActivas) consulta = consulta.eq('estado', 'activa');
    const { data, error } = await consulta;
    if (error) throw new RepositoryError('reglas.listar', error);
    return data ?? [];
  }

  async crearRegla({ empresaId, nombre, condicion, severidad, mensajePlantilla }) {
    const { data, error } = await this._client
      .from('reglas')
      .insert({ empresa_id: exigirUuid(empresaId, 'empresaId'), nombre, condicion, severidad, mensaje_plantilla: mensajePlantilla })
      .select('id')
      .single();
    if (error) throw new RepositoryError('reglas.crear', error);
    return data;
  }

  async cambiarEstadoRegla(reglaId, estado) {
    const { data, error } = await this._client.from('reglas').update({ estado }).eq('id', exigirUuid(reglaId, 'reglaId')).select('id').single();
    if (error) throw new RepositoryError('reglas.cambiarEstado', error);
    return data;
  }

  async listarPlantillas(empresaId) {
    const id = exigirUuid(empresaId, 'empresaId');
    const { data, error } = await this._client
      .from('recomendaciones_plantillas')
      .select('id, empresa_id, codigo, titulo, texto, condicion_activacion')
      .or(`empresa_id.eq.${id},empresa_id.is.null`);
    if (error) throw new RepositoryError('plantillas.listar', error);
    return data ?? [];
  }

  /**
   * Valores históricos válidos de una métrica para calcular percentiles.
   * @param {{empresaId: string, indicador: string, dias?: number, excluirEvaluacionId?: string|null}} o
   * @returns {Promise<number[]>}
   */
  async historicoMetrica({ empresaId, indicador, dias = 90, excluirEvaluacionId = null }) {
    const id = exigirUuid(empresaId, 'empresaId');
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    if (indicador === 'ico') {
      let q = this._client.from('evaluaciones').select('ico_valor').eq('empresa_id', id).gte('fecha', desde).not('ico_valor', 'is', null).limit(5000);
      if (excluirEvaluacionId) q = q.neq('id', exigirUuid(excluirEvaluacionId, 'evaluacionId'));
      const { data, error } = await q;
      if (error) throw new RepositoryError('reglas.historicoIco', error);
      return (data ?? []).map((f) => Number(f.ico_valor));
    }
    const [codigo, metrica] = String(indicador).split('.');
    const columna = COLUMNA_METRICA[metrica];
    if (!codigo || !columna) return [];
    let q = this._client
      .from('resultados_pruebas')
      .select(`${columna}, prueba_version:pruebas_versiones!inner(prueba:pruebas!pruebas_versiones_prueba_id_fkey!inner(codigo))`)
      .eq('empresa_id', id)
      .eq('es_valido_para_analisis', true)
      .eq('prueba_version.prueba.codigo', codigo)
      .gte('created_at', desde)
      .not(columna, 'is', null)
      .limit(5000);
    if (excluirEvaluacionId) q = q.neq('evaluacion_id', exigirUuid(excluirEvaluacionId, 'evaluacionId'));
    const { data, error } = await q;
    if (error) throw new RepositoryError('reglas.historicoMetrica', error);
    return (data ?? []).map((f) => Number(f[columna]));
  }

  /** @returns {Promise<{alertas: number, recomendaciones: number}>} */
  async publicarResultado(empresaId, alertas, recomendaciones) {
    if (alertas.length === 0 && recomendaciones.length === 0) return { alertas: 0, recomendaciones: 0 };
    const { data, error } = await this._client.rpc('publicar_resultado_reglas', {
      p_empresa: exigirUuid(empresaId, 'empresaId'),
      p_alertas: alertas,
      p_recomendaciones: recomendaciones,
    });
    if (error) throw new RepositoryError('reglas.publicarResultado', error);
    return data;
  }

  /**
   * @param {string} empresaId
   * @param {{estado?: string|null, pagina?: number}} [filtros]
   * @returns {Promise<{filas: object[], total: number}>}
   */
  async listarAlertas(empresaId, { estado = null, pagina = 0 } = {}) {
    const id = exigirUuid(empresaId, 'empresaId');
    const desde = Math.max(Math.trunc(pagina) || 0, 0) * TAMANO_PAGINA_ALERTAS;
    let q = this._client
      .from('alertas')
      .select('id, operador_id, evaluacion_id, severidad, mensaje, estado, atendida_en, created_at, regla:reglas(nombre)', { count: 'exact' })
      .eq('empresa_id', id)
      .order('created_at', { ascending: false })
      .range(desde, desde + TAMANO_PAGINA_ALERTAS - 1);
    if (estado) q = q.eq('estado', estado);
    const { data, error, count } = await q;
    if (error) throw new RepositoryError('alertas.listar', error);
    return { filas: data ?? [], total: count ?? 0 };
  }

  async resolverAlerta(alertaId, estado) {
    const { data, error } = await this._client.from('alertas').update({ estado }).eq('id', exigirUuid(alertaId, 'alertaId')).select('id').single();
    if (error) throw new RepositoryError('alertas.resolver', error);
    return data;
  }
}

export default ReglasRepository;
