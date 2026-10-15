/**
 * @module statistics/ico
 * @description Motor del ICO (Fase 2 §2):
 * combina los puntajes normalizados 0–100 de las pruebas con los pesos
 * configurados por empresa (y opcionalmente por cargo) y devuelve un número
 * 0–100 más el detalle de cómo se compuso. No conoce reglas de alerta.
 *
 * Reglas de cálculo (explícitas para ser auditables):
 *  - Los pesos son relativos (no tienen que sumar 100); se normalizan.
 *  - Una prueba con peso 0 no es requerida ni aporta.
 *  - Si falta el puntaje de una prueba con peso > 0 el ICO se calcula
 *    re-normalizando sobre las disponibles SOLO si la `cobertura` (fracción del
 *    peso total presente) alcanza `coberturaMinima` (por defecto 1: ICO
 *    completo). Si no alcanza, `valor` es null con motivo `cobertura_insuficiente`.
 *  - Un puntaje fuera de [0, 100] es un defecto aguas arriba y lanza error.
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C, esNumeroFinito } from './scientific-error.js';

/**
 * Valida y devuelve los pesos como lista ordenada por código.
 * @param {unknown} pesos Objeto {codigo_prueba: número ≥ 0}.
 * @returns {Array<[string, number]>}
 * @throws {ScientificError}
 */
export function validarPesos(pesos) {
  if (!pesos || typeof pesos !== 'object' || Array.isArray(pesos)) {
    throw new ScientificError(C.PESOS_INVALIDOS, 'Los pesos deben ser un objeto {prueba: peso}.');
  }
  const entradas = Object.entries(pesos);
  if (entradas.length === 0) throw new ScientificError(C.PESOS_INVALIDOS, 'Debe configurarse al menos un peso.');
  for (const [codigo, peso] of entradas) {
    if (!esNumeroFinito(peso) || peso < 0) {
      throw new ScientificError(C.PESOS_INVALIDOS, `Peso inválido para "${codigo}": debe ser un número ≥ 0.`);
    }
  }
  if (entradas.every(([, peso]) => peso === 0)) {
    throw new ScientificError(C.PESOS_INVALIDOS, 'Al menos un peso debe ser mayor que 0.');
  }
  return entradas.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * @typedef {Object} DetalleICO
 * @property {string} prueba
 * @property {number} puntaje        Puntaje 0–100 de la prueba.
 * @property {number} pesoConfigurado
 * @property {number} pesoEfectivo   Fracción [0,1] tras normalizar sobre las disponibles.
 * @property {number} aporte         puntaje × pesoEfectivo.
 */

/**
 * @param {Record<string, number|null|undefined>} puntajes Puntaje 0–100 por código de prueba.
 * @param {Record<string, number>} pesos Pesos por código de prueba.
 * @param {{coberturaMinima?: number}} [opciones]
 * @returns {{valor: number|null, motivo: string|null, cobertura: number, detalle: DetalleICO[],
 *   faltantes: string[], sinPeso: string[]}}
 */
export function calcularICO(puntajes, pesos, { coberturaMinima = 1 } = {}) {
  const lista = validarPesos(pesos);
  if (!puntajes || typeof puntajes !== 'object' || Array.isArray(puntajes)) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'Los puntajes deben ser un objeto {prueba: puntaje}.');
  }
  if (!esNumeroFinito(coberturaMinima) || coberturaMinima <= 0 || coberturaMinima > 1) {
    throw new ScientificError(C.ENTRADA_INVALIDA, 'coberturaMinima debe estar en (0, 1].');
  }

  const pesoTotal = lista.reduce((suma, [, peso]) => suma + peso, 0);
  const faltantes = [];
  const presentes = [];
  for (const [codigo, peso] of lista) {
    if (peso === 0) continue;
    const puntaje = puntajes[codigo];
    if (puntaje === null || puntaje === undefined) {
      faltantes.push(codigo);
      continue;
    }
    if (!esNumeroFinito(puntaje) || puntaje < 0 || puntaje > 100) {
      throw new ScientificError(C.PUNTAJE_FUERA_DE_RANGO, `Puntaje inválido para "${codigo}": ${String(puntaje)}.`);
    }
    presentes.push([codigo, peso, puntaje]);
  }
  const sinPeso = Object.keys(puntajes).filter((c) => !(c in pesos) || pesos[c] === 0).sort();

  const pesoPresente = presentes.reduce((suma, [, peso]) => suma + peso, 0);
  const cobertura = pesoPresente / pesoTotal;
  // Tolerancia de 1e-12 para que 0.3+0.7 no falle por redondeo contra coberturaMinima = 1.
  if (presentes.length === 0 || cobertura + 1e-12 < coberturaMinima) {
    return { valor: null, motivo: 'cobertura_insuficiente', cobertura, detalle: [], faltantes, sinPeso };
  }

  const detalle = presentes.map(([prueba, pesoConfigurado, puntaje]) => {
    const pesoEfectivo = pesoConfigurado / pesoPresente;
    return { prueba, puntaje, pesoConfigurado, pesoEfectivo, aporte: puntaje * pesoEfectivo };
  });
  const valor = Math.round(detalle.reduce((suma, d) => suma + d.aporte, 0) * 100) / 100;
  return { valor, motivo: null, cobertura: Math.min(cobertura, 1), detalle, faltantes, sinPeso };
}

/**
 * @typedef {Object} ConfiguracionICO
 * @property {string} id
 * @property {string|null} cargo_id
 * @property {Record<string, number>} pesos
 * @property {string|Date} vigente_desde
 * @property {string|Date|null} vigente_hasta
 */

/**
 * Selecciona la configuración vigente en `fecha`: la del cargo si existe, y si
 * no, la de la empresa (cargo_id nulo). Vigencia = [desde, hasta).
 * @param {ConfiguracionICO[]} configuraciones Ya filtradas por empresa.
 * @param {{cargoId?: string|null, fecha?: string|Date}} [contexto]
 * @returns {ConfiguracionICO}
 * @throws {ScientificError} Si no hay configuración vigente aplicable.
 */
export function seleccionarConfiguracionICO(configuraciones, { cargoId = null, fecha = new Date() } = {}) {
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) throw new ScientificError(C.ENTRADA_INVALIDA, 'Fecha de referencia inválida.');
  const vigentes = (configuraciones ?? []).filter((c) => {
    const desde = new Date(c.vigente_desde).getTime();
    const hasta = c.vigente_hasta ? new Date(c.vigente_hasta).getTime() : Infinity;
    return desde <= t && t < hasta;
  });
  const masReciente = (lista) => lista.sort((a, b) => new Date(b.vigente_desde) - new Date(a.vigente_desde))[0];
  const delCargo = cargoId ? masReciente(vigentes.filter((c) => c.cargo_id === cargoId)) : undefined;
  const general = masReciente(vigentes.filter((c) => c.cargo_id === null || c.cargo_id === undefined));
  const elegida = delCargo ?? general;
  if (!elegida) {
    throw new ScientificError(C.CONFIGURACION_NO_ENCONTRADA, 'No hay configuración de ICO vigente para la fecha y cargo indicados.');
  }
  return elegida;
}

export default { calcularICO, validarPesos, seleccionarConfiguracionICO };
