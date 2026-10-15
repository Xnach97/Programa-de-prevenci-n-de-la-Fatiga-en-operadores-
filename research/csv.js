/**
 * @module research/csv
 * @description Serialización CSV segura (RFC 4180) para los datasets de investigación.
 *  - Comillas y saltos de línea escapados.
 *  - Protección contra INYECCIÓN DE FÓRMULAS: una celda de texto que empiece por
 *    `=`, `+`, `-`, `@`, tab o CR se prefija con `'` para que Excel/Sheets no la ejecute.
 *    Los NÚMEROS reales no se alteran (un -3 numérico sigue siendo -3).
 *  - BOM UTF-8 opcional para que Excel respete los acentos.
 */

const PELIGROSO = /^[=+\-@\t\r]/;

/** @param {unknown} valor @returns {string} */
export function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  let texto;
  if (typeof valor === 'number') texto = Number.isFinite(valor) ? String(valor) : '';
  else if (typeof valor === 'boolean') texto = valor ? 'true' : 'false';
  else {
    texto = String(valor);
    if (PELIGROSO.test(texto)) texto = `'${texto}`;
  }
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * @param {Array<Record<string, unknown>>} filas
 * @param {string[]} columnas Orden y nombres de las columnas.
 * @param {{bom?: boolean}} [opciones]
 * @returns {string}
 */
export function aCsv(filas, columnas, { bom = true } = {}) {
  const lineas = [columnas.map(celdaCsv).join(','), ...filas.map((f) => columnas.map((c) => celdaCsv(f[c])).join(','))];
  return `${bom ? '﻿' : ''}${lineas.join('\r\n')}\r\n`;
}

export const COLUMNAS_DATASET = Object.freeze([
  'participante', 'fecha', 'turno', 'prueba', 'intento', 'valido_para_analisis',
  'tiempo_total_ms', 'errores_totales', 'puntaje_normalizado', 'ico_valor', 'ico_nivel',
]);

export default { aCsv, celdaCsv, COLUMNAS_DATASET };
