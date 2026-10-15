/**
 * @module services/scientific-service
 * @description Orquestación del Scientific Engine (Fase 2 §4): puntaje → ICO →
 * clasificación por baremo, con trazabilidad de la versión de configuración
 * usada (`ico_configuracion_id`, `baremo_snapshot_id` de `evaluaciones`).
 *
 * Los cálculos viven en `statistics/*` (puros). Aquí solo se obtiene la
 * configuración y se compone. Dependencias inyectadas por constructor.
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C } from '../statistics/scientific-error.js';
import { puntuar } from '../statistics/score.js';
import { calcularICO, seleccionarConfiguracionICO, validarPesos } from '../statistics/ico.js';
import { crearEstrategia, seleccionarBaremoVigente, MODALIDADES, DIRECCIONES } from '../statistics/baremos.js';

/** El ICO es una escala donde MÁS es mejor; si el baremo no lo dice, así se interpreta. */
function conDireccionDelIco(fila) {
  return { ...fila, parametros: { direccion: DIRECCIONES.MAYOR_MEJOR, ...fila.parametros } };
}

export class ScientificService {
  /**
   * @param {{
   *   ico: {listar: (empresaId: string) => Promise<object[]>},
   *   baremos: {listar: (empresaId: string) => Promise<object[]>},
   *   obtenerModalidad: (empresaId: string) => Promise<string>,
   *   obtenerHistorialIco?: (contexto: {empresaId: string, fecha: Date, ventanaDias: number}) => Promise<Array<{valor: number, fecha: string|Date}>>,
   * }} dependencias
   *   `obtenerModalidad` lee `configuracion_empresa.baremo_modalidad`.
   *   `obtenerHistorialIco` solo es necesario con baremo dinámico (lo aportará el Testing Engine).
   */
  constructor({ ico, baremos, obtenerModalidad, obtenerHistorialIco = async () => [] }) {
    if (!ico || !baremos || typeof obtenerModalidad !== 'function') {
      throw new TypeError('ScientificService requiere repositorios ico y baremos, y obtenerModalidad.');
    }
    this._ico = ico;
    this._baremos = baremos;
    this._obtenerModalidad = obtenerModalidad;
    this._obtenerHistorialIco = obtenerHistorialIco;
  }

  /**
   * Normaliza resultados crudos a 0–100.
   * @param {Array<{prueba: string, funcionPuntuacion: string, crudo: any, parametros?: object}>} resultados
   * @returns {Record<string, number>} Puntaje por código de prueba.
   */
  calcularPuntajes(resultados) {
    const puntajes = {};
    for (const r of resultados ?? []) {
      if (!r?.prueba || r.prueba in puntajes) {
        throw new ScientificError(C.ENTRADA_INVALIDA, `Resultado sin código de prueba o repetido: "${String(r?.prueba)}".`);
      }
      puntajes[r.prueba] = puntuar(r.funcionPuntuacion, r.crudo, r.parametros ?? {});
    }
    return puntajes;
  }

  /**
   * Calcula el ICO de una evaluación y lo clasifica.
   * @param {{empresaId: string, cargoId?: string|null, fecha?: Date|string,
   *   puntajes: Record<string, number|null>, coberturaMinima?: number}} entrada
   * @returns {Promise<{ico: ReturnType<typeof calcularICO>, clasificacion: object,
   *   icoConfiguracionId: string, baremoId: string|null}>}
   */
  async evaluar({ empresaId, cargoId = null, fecha = new Date(), puntajes, coberturaMinima }) {
    const configuraciones = await this._ico.listar(empresaId);
    const configuracion = seleccionarConfiguracionICO(configuraciones, { cargoId, fecha });
    const ico = calcularICO(puntajes, configuracion.pesos, coberturaMinima === undefined ? {} : { coberturaMinima });

    if (ico.valor === null) {
      return {
        ico,
        clasificacion: { nivel: null, motivo: ico.motivo, modalidad: null, limites: null, z: null, muestra: null },
        icoConfiguracionId: configuracion.id,
        baremoId: null,
      };
    }

    const modalidad = await this._obtenerModalidad(empresaId);
    const filas = await this._baremos.listar(empresaId);
    const fila = conDireccionDelIco(seleccionarBaremoVigente(filas, { empresaId, modalidad, pruebaId: null, fecha }));
    const estrategia = crearEstrategia(fila);

    const historial =
      modalidad === MODALIDADES.DINAMICO
        ? await this._obtenerHistorialIco({ empresaId, fecha: new Date(fecha), ventanaDias: fila.parametros.ventana_dias })
        : [];

    return {
      ico,
      clasificacion: estrategia.clasificar(ico.valor, { historial, fecha }),
      icoConfiguracionId: configuracion.id,
      baremoId: fila.id,
    };
  }
}

/**
 * Casos de uso de ADMINISTRACIÓN de la configuración científica: valida en
 * cliente (mensaje inmediato) y publica una versión nueva. RLS decide quién
 * puede (`configuracion.editar` / `baremos.editar`).
 */
export class ConfiguracionCientificaService {
  /** @param {{ico: {publicar: Function}, baremos: {publicar: Function}}} dependencias */
  constructor({ ico, baremos }) {
    if (!ico || !baremos) throw new TypeError('ConfiguracionCientificaService requiere repositorios ico y baremos.');
    this._ico = ico;
    this._baremos = baremos;
  }

  /**
   * @param {{empresaId: string, cargoId?: string|null, pesos: Record<string, number>}} datos
   * @returns {Promise<string>} Id de la nueva versión.
   */
  async publicarPesos({ empresaId, cargoId = null, pesos }) {
    validarPesos(pesos);
    return this._ico.publicar({ empresaId, cargoId, pesos });
  }

  /**
   * @param {{empresaId: string|null, pruebaId?: string|null, modalidad: string, parametros: object, fuente?: string|null}} datos
   * @returns {Promise<string>} Id de la nueva versión.
   */
  async publicarBaremo({ empresaId, pruebaId = null, modalidad, parametros, fuente = null }) {
    crearEstrategia({ modalidad, parametros }); // lanza ScientificError si es inválido
    if (modalidad === MODALIDADES.CIENTIFICO && (!fuente || String(fuente).trim() === '')) {
      throw new ScientificError(C.BAREMO_INVALIDO, 'El baremo científico requiere citar su fuente.');
    }
    return this._baremos.publicar({ empresaId, pruebaId, modalidad, parametros, fuente });
  }
}

export default { ScientificService, ConfiguracionCientificaService };
