/**
 * @module services/configuracion-service
 * @description Casos de uso de la pantalla de configuración de la empresa
 * (Fase 2 §2: `admin/configuracion.js`): marca, turnos, pruebas activas,
 * modalidad de baremo, pesos del ICO y baremo del ICO. Valida en cliente para
 * dar mensajes inmediatos; la BD vuelve a validar (CHECK/RLS).
 */

import { sanitizarColor, sanitizarFuente, sanitizarLogoUrl } from '../js/brand.js';
import { ScientificError } from '../statistics/scientific-error.js';

export const MODALIDADES_BAREMO = Object.freeze(['dinamico', 'institucional', 'cientifico']);
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TURNOS = 6;

export class ConfiguracionError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ConfiguracionError';
    this.codigo = 'validacion';
  }
}

const falla = (mensaje) => {
  throw new ConfiguracionError(mensaje);
};

/** @param {object} marca @returns {object} Marca saneada (sin claves vacías). */
export function validarMarca(marca) {
  const salida = {};
  for (const clave of ['color_primario', 'color_secundario', 'color_acento']) {
    const v = marca?.[clave];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const color = sanitizarColor(v);
    if (!color) falla(`Color inválido en ${clave.replace('color_', '')}: use el formato #RRGGBB.`);
    salida[clave] = color;
  }
  for (const clave of ['tipografia_display', 'tipografia_base']) {
    const v = marca?.[clave];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const fuente = sanitizarFuente(v);
    if (!fuente) falla(`Tipografía inválida (${clave}).`);
    salida[clave] = fuente;
  }
  const logo = marca?.logo_url;
  if (logo !== undefined && logo !== null && String(logo).trim() !== '') {
    const url = sanitizarLogoUrl(logo);
    if (!url) falla('El logo debe ser una URL https válida.');
    salida.logo_url = url;
  }
  return salida;
}

/** @param {Array<{nombre: string, hora_inicio: string, hora_fin: string}>} turnos */
export function validarTurnos(turnos) {
  if (!Array.isArray(turnos) || turnos.length > MAX_TURNOS) falla(`Configure entre 0 y ${MAX_TURNOS} turnos.`);
  const vistos = new Set();
  return turnos.map((t) => {
    const nombre = String(t?.nombre ?? '').trim();
    if (nombre.length < 1 || nombre.length > 60) falla('El nombre del turno debe tener entre 1 y 60 caracteres.');
    if (vistos.has(nombre.toLowerCase())) falla(`El turno "${nombre}" está repetido.`);
    vistos.add(nombre.toLowerCase());
    if (!HORA.test(t.hora_inicio) || !HORA.test(t.hora_fin)) falla(`Horario inválido en el turno "${nombre}" (use HH:MM).`);
    return { nombre, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin };
  });
}

export class ConfiguracionService {
  /**
   * @param {{empresas: {actualizarConfiguracion: Function}, cientifica: import('./scientific-service.js').ConfiguracionCientificaService,
   *   codigosPruebas: () => string[]}} deps
   */
  constructor({ empresas, cientifica, codigosPruebas }) {
    if (!empresas || !cientifica || typeof codigosPruebas !== 'function') {
      throw new TypeError('ConfiguracionService requiere empresas, cientifica y codigosPruebas.');
    }
    this._empresas = empresas;
    this._cientifica = cientifica;
    this._codigosPruebas = codigosPruebas;
  }

  /**
   * @param {{empresaId: string, usuarioId?: string|null, marca: object, turnos: object[], pruebasActivas: string[], baremoModalidad: string}} datos
   */
  async guardarGeneral({ empresaId, usuarioId = null, marca, turnos, pruebasActivas, baremoModalidad }) {
    if (!MODALIDADES_BAREMO.includes(baremoModalidad)) falla('Modalidad de baremo inválida.');
    const conocidas = new Set(this._codigosPruebas());
    const activas = [...new Set(pruebasActivas ?? [])];
    if (activas.some((c) => !conocidas.has(c))) falla('Se seleccionó una prueba desconocida.');
    return this._empresas.actualizarConfiguracion(
      empresaId,
      { marca: validarMarca(marca), turnos: validarTurnos(turnos), pruebas_activas: activas, baremo_modalidad: baremoModalidad },
      usuarioId,
    );
  }

  /** Los errores del motor científico traen un texto en español redactado para el usuario. */
  async _traducir(operacion) {
    try {
      return await operacion();
    } catch (error) {
      if (error instanceof ScientificError) throw new ConfiguracionError(error.message);
      throw error;
    }
  }

  /**
   * Pesos del ICO por prueba (valores ≥ 0; el motor los normaliza).
   * @param {{empresaId: string, cargoId?: string|null, pesos: Record<string, number>}} datos
   */
  async publicarPesos({ empresaId, cargoId = null, pesos }) {
    const conocidas = new Set(this._codigosPruebas());
    for (const codigo of Object.keys(pesos ?? {})) if (!conocidas.has(codigo)) falla(`Prueba desconocida en los pesos: "${codigo}".`);
    return this._traducir(() => this._cientifica.publicarPesos({ empresaId, cargoId, pesos }));
  }

  /**
   * Baremo del ICO de la empresa. El ICO es una escala donde MÁS es mejor, así que
   * `direccion` se fija en `mayor_mejor` (la BD exige coherencia con los umbrales).
   * @param {{empresaId: string, modalidad: 'dinamico'|'institucional', excelente?: number, atencion?: number, ventanaDias?: number, minimoRegistros?: number}} datos
   */
  async publicarBaremoIco({ empresaId, modalidad, excelente, atencion, ventanaDias, minimoRegistros }) {
    if (modalidad === 'institucional') {
      const ok = (x) => Number.isFinite(x) && x >= 0 && x <= 100;
      if (!ok(excelente) || !ok(atencion)) falla('Los umbrales deben ser números entre 0 y 100.');
      if (excelente < atencion) falla('El umbral «excelente» no puede ser menor que el de «requiere atención».');
      return this._traducir(() =>
        this._cientifica.publicarBaremo({
          empresaId,
          modalidad,
          parametros: { direccion: 'mayor_mejor', umbrales: { excelente, atencion } },
          fuente: 'Definido por la empresa',
        }),
      );
    }
    if (modalidad === 'dinamico') {
      if (!Number.isInteger(ventanaDias) || ventanaDias < 1 || ventanaDias > 730) falla('La ventana debe ser un entero entre 1 y 730 días.');
      if (!Number.isInteger(minimoRegistros) || minimoRegistros < 2 || minimoRegistros > 10_000) falla('El mínimo de registros debe ser un entero ≥ 2.');
      return this._traducir(() =>
        this._cientifica.publicarBaremo({
          empresaId,
          modalidad,
          parametros: { direccion: 'mayor_mejor', ventana_dias: ventanaDias, minimo_registros: minimoRegistros },
        }),
      );
    }
    return falla('Los baremos científicos los publica el responsable científico con su fuente bibliográfica.');
  }
}

export default { ConfiguracionService, ConfiguracionError, validarMarca, validarTurnos, MODALIDADES_BAREMO };
