/**
 * @module dashboard/dashboard-service
 * @description Datos de los cuatro dashboards (Fase 3 §10). REGLA: se lee SOLO
 * de `indicadores_valores` (vía `IndicadoresRepository.leer`) y de `alertas`;
 * jamás se agrega sobre `resultados_pruebas`. Cada método devuelve estructuras
 * planas listas para pintar; no toca el DOM.
 */

import { sumarDias, CODIGOS_INDICADOR as C } from '../statistics/indicadores.js';
import { promedioMovil, resumenDescriptivo, histograma, detectarOutliers } from '../statistics/analytics.js';
import { construirCurva } from '../statistics/gaussian.js';
import { esPeriodoDiario, serieDiaria, etiquetaAnonima } from './chart-math.js';

const DIAS_TENDENCIA = 30;
const redondear = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export class DashboardService {
  /**
   * @param {{indicadores: object, reglas: object, operadores?: object|null, catalogos?: object|null}} deps
   *   `operadores` se omite cuando el usuario no puede ver nombres (se muestran etiquetas anónimas).
   */
  constructor({ indicadores, reglas, operadores = null, catalogos = null }) {
    if (!indicadores || !reglas) throw new TypeError('DashboardService requiere indicadores y reglas.');
    this._ind = indicadores;
    this._reglas = reglas;
    this._operadores = operadores;
    this._catalogos = catalogos;
  }

  /** Mapa id→nombre de un catálogo (área o cargo). */
  async _nombres(catalogo, empresaId) {
    if (!this._catalogos) return new Map();
    const filas = await this._catalogos.listar(catalogo, empresaId, { incluirInactivos: true });
    return new Map(filas.map((f) => [f.id, f.nombre]));
  }

  async _etiquetasOperadores(empresaId, ids) {
    const etiquetas = new Map(ids.map((id) => [id, etiquetaAnonima(id)]));
    if (!this._operadores) return etiquetas;
    const nombres = await this._operadores.nombresPorIds(empresaId, ids);
    for (const [id, nombre] of nombres) if (nombre) etiquetas.set(id, nombre);
    return etiquetas;
  }

  /** Valores de un día exacto, por código → Map(ambito_id → fila). */
  async _dia(empresaId, codigos, dia) {
    const filas = await this._ind.leer({ empresaId, codigos, desde: dia, hasta: sumarDias(dia, 1), exacto: true });
    const porCodigo = new Map(codigos.map((c) => [c, new Map()]));
    for (const f of filas) if (!porCodigo.get(f.codigo).has(f.ambito_id)) porCodigo.get(f.codigo).set(f.ambito_id, f);
    return porCodigo;
  }

  /** Serie diaria continua de un indicador para un ámbito. */
  async _serie(empresaId, codigo, ambitoId, desde, hasta) {
    const filas = (await this._ind.leer({ empresaId, codigos: [codigo], desde, hasta: sumarDias(hasta, 1), ambitoId })).filter(esPeriodoDiario);
    const unicas = new Map();
    for (const f of filas) if (!unicas.has(f.desde)) unicas.set(f.desde, f); // la lectura viene de más reciente a más antigua
    return serieDiaria([...unicas.values()], desde, hasta);
  }

  /**
   * Operativo: KPIs del día, ICO por área y tabla de operadores.
   * @returns {Promise<{dia: string, kpis: object, porArea: Array, operadores: Array}>}
   */
  async operativo(empresaId, dia) {
    const [dato, areas, alertas] = await Promise.all([
      this._dia(empresaId, [C.ICO_TRABAJADOR, C.INDICE_RIESGO, C.INDICE_FATIGA, C.ICO_AREA, C.ICO_EMPRESA], dia),
      this._nombres('areas', empresaId),
      this._reglas.listarAlertas(empresaId, { estado: 'abierta', pagina: 0 }),
    ]);
    const ico = dato.get(C.ICO_TRABAJADOR);
    const riesgo = dato.get(C.INDICE_RIESGO);
    const fatiga = dato.get(C.INDICE_FATIGA);
    const empresa = [...dato.get(C.ICO_EMPRESA).values()][0] ?? null;
    const ids = [...ico.keys()];
    const etiquetas = await this._etiquetasOperadores(empresaId, ids);
    const operadores = ids
      .map((id) => ({
        operadorId: id,
        etiqueta: etiquetas.get(id),
        ico: redondear(ico.get(id).valor),
        riesgo: riesgo.has(id) ? redondear(riesgo.get(id).valor) : null,
        fatiga: fatiga.has(id) ? redondear(fatiga.get(id).valor) : null,
      }))
      .sort((a, b) => (a.ico ?? 0) - (b.ico ?? 0));
    return {
      dia,
      kpis: {
        evaluados: ids.length,
        icoPromedio: empresa ? redondear(empresa.valor) : redondear(media(operadores.map((o) => o.ico).filter((v) => v !== null))),
        enRiesgo: operadores.filter((o) => (o.riesgo ?? 0) > 0).length,
        alertasAbiertas: alertas.total,
      },
      porArea: [...dato.get(C.ICO_AREA).values()].map((f) => ({ etiqueta: areas.get(f.ambito_id) ?? etiquetaAnonima(f.ambito_id), valor: redondear(f.valor) })).sort((a, b) => b.valor - a.valor),
      operadores,
    };
  }

  /**
   * Clínico (un operador): evolución del ICO con media móvil de 7 días,
   * radar mensual por categoría y últimas recomendaciones.
   */
  async clinico(empresaId, operadorId, dia) {
    const desde = sumarDias(dia, -(DIAS_TENDENCIA - 1));
    const hasta = sumarDias(dia, 1);
    const [serie, mensual, recomendaciones, alertas, etiquetas] = await Promise.all([
      this._serie(empresaId, C.ICO_TRABAJADOR, operadorId, desde, dia),
      this._ind.leer({
        empresaId,
        codigos: [C.INDICE_ATENCION, C.INDICE_MEMORIA, C.INDICE_VELOCIDAD, C.INDICE_INHIBICION, C.INDICE_FATIGA, C.INDICE_RIESGO],
        desde: sumarDias(dia, -29),
        hasta,
        ambitoId: operadorId,
        exacto: true,
      }),
      this._reglas.recomendacionesDeOperador(empresaId, operadorId, 5),
      this._reglas.listarAlertas(empresaId, { estado: 'abierta', operadorId }),
      this._etiquetasOperadores(empresaId, [operadorId]),
    ]);
    const valor = (c) => mensual.find((f) => f.codigo === c)?.valor ?? null;
    const movil = promedioMovil(serie.map((p) => p.valor), 7);
    return {
      etiqueta: etiquetas.get(operadorId),
      serie: serie.map((p, i) => ({ dia: p.dia, valor: p.valor, movil: movil[i] ?? null })),
      radar: [
        { clave: 'atencion', valor: valor(C.INDICE_ATENCION) },
        { clave: 'memoria', valor: valor(C.INDICE_MEMORIA) },
        { clave: 'velocidad', valor: valor(C.INDICE_VELOCIDAD) },
        { clave: 'inhibicion', valor: valor(C.INDICE_INHIBICION) },
      ],
      fatiga: valor(C.INDICE_FATIGA),
      riesgo: valor(C.INDICE_RIESGO),
      recomendaciones,
      alertasAbiertas: alertas.total,
    };
  }

  /** Ejecutivo: indicadores de empresa, tendencia a 30 días y comparación por área y cargo. */
  async ejecutivo(empresaId, dia) {
    const desde = sumarDias(dia, -(DIAS_TENDENCIA - 1));
    const [hoy, tendencia, areas, cargos, alertas] = await Promise.all([
      this._dia(empresaId, [C.ICO_EMPRESA, C.INDICE_FATIGA_EMPRESA, C.INDICE_RIESGO_EMPRESA, C.ICO_AREA, C.ICO_CARGO, C.INDICE_RIESGO_AREA], dia),
      this._serie(empresaId, C.ICO_EMPRESA, empresaId, desde, dia),
      this._nombres('areas', empresaId),
      this._nombres('cargos', empresaId),
      this._reglas.listarAlertas(empresaId, { estado: 'abierta' }),
    ]);
    const unico = (c) => [...hoy.get(c).values()][0]?.valor ?? null;
    const riesgoArea = hoy.get(C.INDICE_RIESGO_AREA);
    const comparar = (codigo, nombres) =>
      [...hoy.get(codigo).values()]
        .map((f) => ({ etiqueta: nombres.get(f.ambito_id) ?? etiquetaAnonima(f.ambito_id), valor: redondear(f.valor), riesgo: codigo === C.ICO_AREA && riesgoArea.has(f.ambito_id) ? redondear(riesgoArea.get(f.ambito_id).valor) : null }))
        .sort((a, b) => b.valor - a.valor);
    return {
      dia,
      kpis: { ico: redondear(unico(C.ICO_EMPRESA)), fatiga: redondear(unico(C.INDICE_FATIGA_EMPRESA)), riesgo: redondear(unico(C.INDICE_RIESGO_EMPRESA)), alertasAbiertas: alertas.total },
      tendencia,
      porArea: comparar(C.ICO_AREA, areas),
      porCargo: comparar(C.ICO_CARGO, cargos),
    };
  }

  /**
   * Científico: distribución del ICO de los operadores del día con curva
   * gaussiana, percentiles, atípicos y CV. Identidades SIEMPRE anónimas.
   */
  async cientifico(empresaId, dia) {
    const dato = await this._dia(empresaId, [C.ICO_TRABAJADOR], dia);
    const filas = [...dato.get(C.ICO_TRABAJADOR).values()];
    const valores = filas.map((f) => f.valor);
    if (valores.length === 0) return { dia, n: 0, resumen: resumenDescriptivo([]), histograma: { limites: [], conteos: [] }, curva: [], atipicos: [] };
    const resumen = resumenDescriptivo(valores);
    const out = detectarOutliers(valores);
    const indices = Array.isArray(out) ? out : (out.indices ?? []);
    return {
      dia,
      n: valores.length,
      resumen,
      histograma: histograma(valores, { clases: Math.min(10, Math.max(3, Math.ceil(Math.sqrt(valores.length)))), minimo: 0, maximo: 100 }),
      curva: construirCurva(valores, { puntos: 80, dominioMinimo: 0 }).puntos,
      atipicos: indices.map((i) => ({ etiqueta: etiquetaAnonima(filas[i].ambito_id), valor: redondear(valores[i]) })),
    };
  }

  /** Operadores con dato en el día (selector del dashboard clínico). */
  async operadoresDelDia(empresaId, dia) {
    const dato = await this._dia(empresaId, [C.ICO_TRABAJADOR], dia);
    const ids = [...dato.get(C.ICO_TRABAJADOR).keys()];
    const etiquetas = await this._etiquetasOperadores(empresaId, ids);
    return ids.map((id) => ({ id, etiqueta: etiquetas.get(id) })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  }
}

export { redondear };
export default { DashboardService };
