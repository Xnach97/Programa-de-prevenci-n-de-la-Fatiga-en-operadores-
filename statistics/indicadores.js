/**
 * @module statistics/indicadores
 * @description Fórmulas de los indicadores (Fase 3 §8). Funciones PURAS: reciben
 * datos ya leídos y devuelven valores; no tocan red ni DOM. Las definiciones en
 * BD (`indicadores_definiciones.formula_ref`) apuntan a estas funciones.
 *
 * ⚠ FÓRMULAS PROVISIONALES (ver migración 0013): los documentos de arquitectura
 * nombran los indicadores pero no los definen. Validación científica pendiente.
 *
 * Entrada por operador: lista de evaluaciones
 *   { ico_valor: number|null, ico_nivel: string|null, estado?: string,
 *     resultados: [{ categoria, puntaje: number|null, valido: boolean }] }
 */

import { media } from './analytics.js';
import { ScientificError, CODIGOS_CIENTIFICOS as C } from './scientific-error.js';

export const CODIGOS_INDICADOR = Object.freeze({
  ICO_TRABAJADOR: 'ico_trabajador',
  ICO_AREA: 'ico_area',
  ICO_CARGO: 'ico_cargo',
  ICO_EMPRESA: 'ico_empresa',
  INDICE_ATENCION: 'indice_atencion',
  INDICE_MEMORIA: 'indice_memoria',
  INDICE_VELOCIDAD: 'indice_velocidad',
  INDICE_INHIBICION: 'indice_inhibicion',
  INDICE_FATIGA: 'indice_fatiga',
  INDICE_FATIGA_EMPRESA: 'indice_fatiga_empresa',
  INDICE_RIESGO: 'indice_riesgo',
  INDICE_RIESGO_AREA: 'indice_riesgo_area',
  INDICE_RIESGO_EMPRESA: 'indice_riesgo_empresa',
});

const MS_DIA = 86_400_000;
const ZONA = 'America/Bogota';
const NIVEL_RIESGO = 'requiere_atencion';

/** Redondeo a 3 decimales (numeric(10,3) en BD), acotado a [0, 100]. */
export const redondear = (x) => Math.round(Math.min(100, Math.max(0, x)) * 1000) / 1000;

/** @param {Date|string|number} fecha @returns {string} 'YYYY-MM-DD' en hora de Colombia. */
export function fechaLocal(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) throw new ScientificError(C.ENTRADA_INVALIDA, 'Fecha inválida.');
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Suma días a una fecha 'YYYY-MM-DD' (aritmética UTC pura: sin DST). */
export function sumarDias(fecha, dias) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ScientificError(C.ENTRADA_INVALIDA, `Fecha local inválida: "${fecha}".`);
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);
}

/**
 * Ventanas de recálculo para un día: el propio día y los 30 días que terminan en él.
 * `hasta` es EXCLUSIVO (daterange `[)`).
 * @param {string} dia 'YYYY-MM-DD'
 * @returns {{diario: {desde: string, hasta: string}, mensual: {desde: string, hasta: string}}}
 */
export function ventanas(dia) {
  const hasta = sumarDias(dia, 1);
  return { diario: { desde: dia, hasta }, mensual: { desde: sumarDias(dia, -29), hasta } };
}

/** Instante UTC (ISO) del inicio de un día local de Colombia (UTC−5 fijo, sin DST). */
export const inicioDiaLocalISO = (dia) => new Date(`${dia}T00:00:00-05:00`).toISOString();

/** Una evaluación cuenta si está completa y TODOS sus resultados son válidos para análisis. */
export function evaluacionValida(ev) {
  const estadoOk = ev?.estado === undefined || ev.estado === 'completa';
  return estadoOk && Array.isArray(ev?.resultados) && ev.resultados.length > 0 && ev.resultados.every((r) => r.valido === true);
}

const validas = (evaluaciones) => (evaluaciones ?? []).filter(evaluacionValida);
const puntajesDe = (evaluaciones, categorias) =>
  validas(evaluaciones)
    .flatMap((e) => e.resultados)
    .filter((r) => categorias.includes(r.categoria) && Number.isFinite(r.puntaje))
    .map((r) => r.puntaje);

/** @returns {{valor: number, n: number}|null} */
export function icoMedia(evaluaciones) {
  const valores = validas(evaluaciones).map((e) => e.ico_valor).filter(Number.isFinite);
  return valores.length ? { valor: redondear(media(valores)), n: valores.length } : null;
}

export function indiceAtencion(evaluaciones) {
  const p = puntajesDe(evaluaciones, ['atencion']);
  return p.length ? { valor: redondear(media(p)), n: p.length } : null;
}

/** Media del puntaje de las pruebas de una categoría (insumo del radar cognitivo). */
export function indicePorCategoria(evaluaciones, categoria) {
  const p = puntajesDe(evaluaciones, [categoria]);
  return p.length ? { valor: redondear(media(p)), n: p.length } : null;
}

export function indiceFatiga(evaluaciones) {
  const p = puntajesDe(evaluaciones, ['atencion', 'velocidad']);
  return p.length ? { valor: redondear(100 - media(p)), n: p.length } : null;
}

export function indiceRiesgo(evaluaciones) {
  const niveles = validas(evaluaciones).map((e) => e.ico_nivel).filter((n) => typeof n === 'string');
  if (niveles.length === 0) return null;
  return { valor: redondear((niveles.filter((n) => n === NIVEL_RIESGO).length / niveles.length) * 100), n: niveles.length };
}

/**
 * Indicadores de UN operador en una ventana.
 * @returns {Array<{codigo: string, valor: number, detalle: object}>} Solo los calculables.
 */
export function calcularIndicadoresOperador(evaluaciones) {
  const salida = [];
  const anadir = (codigo, r, extra = {}) => r && salida.push({ codigo, valor: r.valor, detalle: { n: r.n, ...extra } });
  anadir(CODIGOS_INDICADOR.ICO_TRABAJADOR, icoMedia(evaluaciones), { evaluaciones_validas: validas(evaluaciones).length });
  anadir(CODIGOS_INDICADOR.INDICE_ATENCION, indiceAtencion(evaluaciones));
  anadir(CODIGOS_INDICADOR.INDICE_MEMORIA, indicePorCategoria(evaluaciones, 'memoria'));
  anadir(CODIGOS_INDICADOR.INDICE_VELOCIDAD, indicePorCategoria(evaluaciones, 'velocidad'));
  anadir(CODIGOS_INDICADOR.INDICE_INHIBICION, indicePorCategoria(evaluaciones, 'inhibicion'));
  anadir(CODIGOS_INDICADOR.INDICE_FATIGA, indiceFatiga(evaluaciones));
  anadir(CODIGOS_INDICADOR.INDICE_RIESGO, indiceRiesgo(evaluaciones));
  return salida;
}

/**
 * Indicadores de grupo (área, cargo, empresa) a partir de los valores POR OPERADOR
 * ya calculados: cada operador pesa lo mismo, sin importar cuántas evaluaciones tenga.
 *
 * @param {{empresaId: string, operadores: Array<{operadorId: string, areaId?: string|null, cargoId?: string|null,
 *   ico?: number, fatiga?: number, riesgo?: number}>}} entrada
 * @returns {Array<{codigo: string, ambitoId: string, valor: number, detalle: object}>}
 */
export function calcularIndicadoresGrupo({ empresaId, operadores }) {
  if (typeof empresaId !== 'string' || !empresaId) throw new ScientificError(C.ENTRADA_INVALIDA, 'empresaId requerido.');
  const salida = [];
  const grupo = (clave, campo, codigo) => {
    const mapa = new Map();
    for (const o of operadores ?? []) {
      const id = clave === 'empresa' ? empresaId : o[clave];
      if (!id || !Number.isFinite(o[campo])) continue;
      if (!mapa.has(id)) mapa.set(id, []);
      mapa.get(id).push(o[campo]);
    }
    for (const [ambitoId, valores] of mapa) {
      salida.push({ codigo, ambitoId, valor: redondear(media(valores)), detalle: { n_operadores: valores.length } });
    }
  };
  grupo('empresa', 'ico', CODIGOS_INDICADOR.ICO_EMPRESA);
  grupo('areaId', 'ico', CODIGOS_INDICADOR.ICO_AREA);
  grupo('cargoId', 'ico', CODIGOS_INDICADOR.ICO_CARGO);
  grupo('empresa', 'fatiga', CODIGOS_INDICADOR.INDICE_FATIGA_EMPRESA);
  grupo('empresa', 'riesgo', CODIGOS_INDICADOR.INDICE_RIESGO_EMPRESA);
  grupo('areaId', 'riesgo', CODIGOS_INDICADOR.INDICE_RIESGO_AREA);
  return salida;
}

export default { calcularIndicadoresOperador, calcularIndicadoresGrupo, ventanas, fechaLocal, evaluacionValida };
