/**
 * @module statistics/rules
 * @description Motor de reglas (Fase 3 §9). Evalúa condiciones DECLARATIVAS
 * (árbol JSON) — nunca texto ejecutable: no hay eval, Function ni plantillas
 * con expresiones. Funciones PURAS.
 *
 * Nodo:
 *   { and: [nodo, …] } | { or: [nodo, …] } | { not: nodo }
 *   hoja: { indicador, op, valor }  |  { indicador, op, percentil }
 *     op ∈ < <= > >= == !=
 *     `percentil` compara contra el percentil p de la distribución histórica de
 *     la empresa para ese indicador (lo resuelve el contexto).
 *
 * Lógica de tres valores: si falta un dato la hoja es DESCONOCIDA (null), y una
 * regla solo se dispara cuando el árbol es verdadero con certeza. Así, la
 * ausencia de un dato nunca genera una alerta (ni un `not` la invierte).
 *
 * Esta validación espeja el CHECK `validar_condicion_regla` de la BD.
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C } from './scientific-error.js';

export const OPERADORES = Object.freeze(['<', '<=', '>', '>=', '==', '!=']);
export const SEVERIDADES = Object.freeze(['info', 'amarilla', 'naranja', 'roja']);
const PROFUNDIDAD_MAXIMA = 5;
const HOJAS_MAXIMAS = 20;
const HIJOS_MAXIMOS = 10;
const RE_INDICADOR = /^[a-z][a-z0-9_]{0,59}(\.[a-z]{1,20})?$/;

const COMPARADORES = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * @param {unknown} nodo
 * @returns {{valida: boolean, error: string|null, hojas: number}}
 */
export function validarCondicion(nodo) {
  let hojas = 0;
  const visitar = (n, profundidad) => {
    if (profundidad > PROFUNDIDAD_MAXIMA) return 'profundidad excesiva';
    if (!esObjeto(n)) return 'nodo inválido';
    const claves = Object.keys(n);
    for (const combinador of ['and', 'or']) {
      if (claves.includes(combinador)) {
        if (claves.length !== 1 || !Array.isArray(n[combinador]) || n[combinador].length < 1 || n[combinador].length > HIJOS_MAXIMOS) {
          return `"${combinador}" requiere de 1 a ${HIJOS_MAXIMOS} condiciones`;
        }
        for (const hijo of n[combinador]) {
          const e = visitar(hijo, profundidad + 1);
          if (e) return e;
        }
        return null;
      }
    }
    if (claves.includes('not')) return claves.length === 1 ? visitar(n.not, profundidad + 1) : '"not" admite una sola condición';

    hojas += 1;
    const ordenadas = [...claves].sort().join(',');
    if (ordenadas !== 'indicador,op,valor' && ordenadas !== 'indicador,op,percentil') return 'hoja con campos no permitidos';
    if (typeof n.indicador !== 'string' || !RE_INDICADOR.test(n.indicador)) return 'indicador inválido';
    if (!OPERADORES.includes(n.op)) return 'operador inválido';
    if ('valor' in n && !(typeof n.valor === 'number' && Number.isFinite(n.valor))) return 'valor debe ser un número';
    if ('percentil' in n && !(typeof n.percentil === 'number' && n.percentil >= 0 && n.percentil <= 100)) return 'percentil debe estar entre 0 y 100';
    return null;
  };
  const error = visitar(nodo, 0);
  if (!error && hojas > HOJAS_MAXIMAS) return { valida: false, error: `máximo ${HOJAS_MAXIMAS} condiciones simples`, hojas };
  return { valida: error === null, error, hojas };
}

/**
 * @typedef {Object} ContextoReglas
 * @property {(indicador: string) => number|null|undefined} valor      Valor actual de la métrica.
 * @property {(indicador: string, percentil: number) => number|null|undefined} [percentil] Umbral por percentil histórico.
 */

/**
 * @param {object} condicion
 * @param {ContextoReglas} contexto
 * @returns {{cumple: boolean, hojas: Array<{indicador: string, op: string, referencia: number|null, valor: number|null, cumple: boolean|null}>}}
 */
export function evaluarCondicion(condicion, contexto) {
  const { valida, error } = validarCondicion(condicion);
  if (!valida) throw new ScientificError(C.ENTRADA_INVALIDA, `Condición de regla inválida: ${error}.`);
  const hojas = [];

  const evaluar = (n) => {
    if (n.and) {
      const r = n.and.map(evaluar);
      return r.includes(false) ? false : r.includes(null) ? null : true;
    }
    if (n.or) {
      const r = n.or.map(evaluar);
      return r.includes(true) ? true : r.includes(null) ? null : false;
    }
    if (n.not) {
      const r = evaluar(n.not);
      return r === null ? null : !r;
    }
    const actual = contexto.valor(n.indicador);
    const referencia = 'percentil' in n ? contexto.percentil?.(n.indicador, n.percentil) : n.valor;
    const ok = (x) => typeof x === 'number' && Number.isFinite(x);
    const resultado = ok(actual) && ok(referencia) ? COMPARADORES[n.op](actual, referencia) : null;
    hojas.push({ indicador: n.indicador, op: n.op, referencia: ok(referencia) ? referencia : null, valor: ok(actual) ? actual : null, cumple: resultado });
    return resultado;
  };

  return { cumple: evaluar(condicion) === true, hojas };
}

/** Indicadores (con percentil) que una condición necesita resolver. */
export function percentilesRequeridos(condicion) {
  const salida = [];
  const recorrer = (n) => {
    const hijos = n.and ?? n.or ?? (n.not ? [n.not] : null);
    if (hijos) hijos.forEach(recorrer);
    else if ('percentil' in n) salida.push({ indicador: n.indicador, percentil: n.percentil });
  };
  recorrer(condicion);
  return salida;
}

/**
 * Sustituye `{clave}` por los datos. Solo claves presentes en `datos`; el resto
 * se deja tal cual. Sin expresiones. Recorta a `maximo` caracteres.
 * @param {string} plantilla
 * @param {Record<string, string|number|null|undefined>} datos
 * @param {number} [maximo]
 */
export function resolverMensaje(plantilla, datos, maximo = 400) {
  const texto = String(plantilla).replace(/\{([a-z_]+)\}/g, (original, clave) => {
    const v = Object.hasOwn(datos, clave) ? datos[clave] : undefined;
    return v === undefined || v === null ? original : String(v);
  });
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/**
 * Arma el árbol de condiciones a partir de las filas de un constructor visual.
 * @param {Array<{indicador: string, op: string, tipo: 'valor'|'percentil', numero: number}>} filas
 * @param {'and'|'or'} combinador
 */
export function construirCondicion(filas, combinador) {
  const hojas = filas.map((f) => ({ indicador: f.indicador, op: f.op, [f.tipo]: f.numero }));
  return hojas.length === 1 ? hojas[0] : { [combinador]: hojas };
}

/** Formatea un número para un mensaje (hasta 1 decimal). */
export const formatearNumero = (x) => (Number.isFinite(x) ? String(Math.round(x * 10) / 10) : null);

export default { validarCondicion, evaluarCondicion, resolverMensaje, percentilesRequeridos };
