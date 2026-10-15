/**
 * @module statistics/baremos
 * @description Clasificación por baremo — tres modalidades como estrategias
 * intercambiables (patrón Strategy, Fase 2 §2): `dinamico`, `institucional` y
 * `cientifico`. El resto del sistema solo pide "clasifícame este valor" sin
 * saber qué modalidad está activa.
 *
 * Unifica los dos sistemas del legado que nunca se reconciliaban (umbrales
 * fijos de `clasificar()` vs baremo dinámico μ±σ, Fase 1 hallazgo #3).
 *
 * Niveles (3, como el "baremo sugerido" del legado): `excelente`,
 * `aceptable`, `requiere_atencion`. Los textos visibles son asunto de la UI.
 *
 * Límites (estrictos, como el legado: "< μ−σ", "> μ+σ"):
 *  - direccion 'menor_mejor' (tiempos, errores): valor < excelente → excelente;
 *    valor > atencion → requiere_atencion; en medio → aceptable.
 *  - direccion 'mayor_mejor' (ICO, puntajes): espejo.
 * Sin `umbrales` explícitos, los límites son μ ∓ σ.
 *
 * Funciones puras: los datos históricos y las filas de `baremos` llegan como
 * argumentos (los obtiene la capa de servicio/repositorio).
 */

import { ScientificError, CODIGOS_CIENTIFICOS as C, esNumeroFinito } from './scientific-error.js';
import { media, desviacionEstandar, zScore } from './analytics.js';

export const MODALIDADES = Object.freeze({ DINAMICO: 'dinamico', INSTITUCIONAL: 'institucional', CIENTIFICO: 'cientifico' });
export const NIVELES = Object.freeze({
  EXCELENTE: 'excelente',
  ACEPTABLE: 'aceptable',
  REQUIERE_ATENCION: 'requiere_atencion',
});
export const DIRECCIONES = Object.freeze({ MENOR_MEJOR: 'menor_mejor', MAYOR_MEJOR: 'mayor_mejor' });

const MS_POR_DIA = 86_400_000;

function baremoInvalido(mensaje) {
  return new ScientificError(C.BAREMO_INVALIDO, mensaje);
}

function validarDireccion(direccion) {
  if (direccion !== DIRECCIONES.MENOR_MEJOR && direccion !== DIRECCIONES.MAYOR_MEJOR) {
    throw baremoInvalido(`direccion debe ser "menor_mejor" o "mayor_mejor" (recibido: ${String(direccion)}).`);
  }
  return direccion;
}

/**
 * Valida los parámetros de un baremo estático (institucional/científico) y
 * devuelve sus límites. Con `umbrales` los usa; si no, μ ∓ σ.
 * @param {{media?: number, desviacion?: number, umbrales?: {excelente: number, atencion: number}, direccion?: string}} parametros
 * @returns {{excelente: number, atencion: number, media: number|null, desviacion: number|null, direccion: string}}
 */
export function limitesDeParametros(parametros) {
  const direccion = validarDireccion(parametros?.direccion ?? DIRECCIONES.MENOR_MEJOR);
  const { umbrales } = parametros ?? {};

  if (umbrales !== undefined) {
    if (!esNumeroFinito(umbrales?.excelente) || !esNumeroFinito(umbrales?.atencion)) {
      throw baremoInvalido('umbrales requiere "excelente" y "atencion" numéricos.');
    }
    const ordenOk =
      direccion === DIRECCIONES.MENOR_MEJOR ? umbrales.excelente <= umbrales.atencion : umbrales.excelente >= umbrales.atencion;
    if (!ordenOk) throw baremoInvalido('Los umbrales no son coherentes con la dirección del baremo.');
    return {
      excelente: umbrales.excelente,
      atencion: umbrales.atencion,
      media: esNumeroFinito(parametros.media) ? parametros.media : null,
      desviacion: esNumeroFinito(parametros.desviacion) ? parametros.desviacion : null,
      direccion,
    };
  }

  if (!esNumeroFinito(parametros?.media) || !esNumeroFinito(parametros?.desviacion) || parametros.desviacion <= 0) {
    throw baremoInvalido('Se requiere "media" y "desviacion" (> 0), o bien "umbrales".');
  }
  const { media: mu, desviacion: sigma } = parametros;
  return direccion === DIRECCIONES.MENOR_MEJOR
    ? { excelente: mu - sigma, atencion: mu + sigma, media: mu, desviacion: sigma, direccion }
    : { excelente: mu + sigma, atencion: mu - sigma, media: mu, desviacion: sigma, direccion };
}

/**
 * Nivel de un valor según límites ya calculados.
 * @returns {string} Uno de NIVELES.
 */
export function nivelDeValor(valor, { excelente, atencion, direccion }) {
  if (!esNumeroFinito(valor)) throw new ScientificError(C.ENTRADA_INVALIDA, 'Solo se clasifican valores finitos.');
  if (direccion === DIRECCIONES.MENOR_MEJOR) {
    if (valor < excelente) return NIVELES.EXCELENTE;
    if (valor > atencion) return NIVELES.REQUIERE_ATENCION;
    return NIVELES.ACEPTABLE;
  }
  if (valor > excelente) return NIVELES.EXCELENTE;
  if (valor < atencion) return NIVELES.REQUIERE_ATENCION;
  return NIVELES.ACEPTABLE;
}

/**
 * @typedef {Object} ResultadoClasificacion
 * @property {string|null} nivel      Null si no se pudo clasificar.
 * @property {string|null} motivo     'datos_insuficientes' cuando nivel es null.
 * @property {string} modalidad
 * @property {{excelente: number, atencion: number}|null} limites
 * @property {number|null} z          Puntaje z respecto de la media del baremo (si se conoce σ).
 * @property {{n: number, minimo: number}|null} muestra  Solo en el dinámico.
 */

function resultado(modalidad, valor, lim) {
  const z = lim.media !== null && lim.desviacion !== null && lim.desviacion > 0 ? zScore(valor, lim.media, lim.desviacion) : null;
  return {
    nivel: nivelDeValor(valor, lim),
    motivo: null,
    modalidad,
    limites: { excelente: lim.excelente, atencion: lim.atencion },
    z,
    muestra: null,
  };
}

/** Estrategia para baremos de parámetros fijos (institucional y científico). */
class EstrategiaEstatica {
  constructor(modalidad, parametros) {
    this.modalidad = modalidad;
    this._limites = limitesDeParametros(parametros); // valida al construir: falla temprano
  }

  clasificar(valor) {
    return resultado(this.modalidad, valor, this._limites);
  }
}

/**
 * Parámetros del baremo dinámico (Fase 3 §7): ventana de recálculo.
 * @typedef {Object} ParametrosDinamicos
 * @property {number} ventana_dias        Ventana hacia atrás desde la fecha de referencia.
 * @property {number} minimo_registros    Mínimo de registros para considerar válido el baremo.
 * @property {string} [direccion]
 */

/**
 * Calcula μ y σ sobre el historial dentro de la ventana, tal como habrían sido
 * en `fechaReferencia` (reproducibilidad: solo cuentan registros con fecha ≤
 * referencia y > referencia − ventana).
 * @param {Array<{valor: number, fecha: string|Date}>} historial
 * @param {ParametrosDinamicos} parametros
 * @param {string|Date} [fechaReferencia]
 * @returns {{n: number, media: number|null, desviacion: number|null, suficiente: boolean}}
 */
export function calcularParametrosDinamicos(historial, parametros, fechaReferencia = new Date()) {
  const ventana = parametros?.ventana_dias;
  const minimo = parametros?.minimo_registros;
  if (!Number.isInteger(ventana) || ventana < 1 || !Number.isInteger(minimo) || minimo < 2) {
    throw baremoInvalido('El baremo dinámico requiere ventana_dias (entero ≥ 1) y minimo_registros (entero ≥ 2).');
  }
  const ref = new Date(fechaReferencia).getTime();
  if (Number.isNaN(ref)) throw new ScientificError(C.ENTRADA_INVALIDA, 'Fecha de referencia inválida.');
  const desde = ref - ventana * MS_POR_DIA;

  const valores = [];
  for (const registro of historial ?? []) {
    const t = new Date(registro?.fecha).getTime();
    if (esNumeroFinito(registro?.valor) && !Number.isNaN(t) && t <= ref && t > desde) valores.push(registro.valor);
  }
  const n = valores.length;
  const sigma = desviacionEstandar(valores);
  const suficiente = n >= minimo && sigma !== null && sigma > 0;
  return { n, media: media(valores), desviacion: sigma, suficiente };
}

/** Estrategia dinámica: recalcula μ/σ del historial en cada clasificación. */
class EstrategiaDinamica {
  constructor(parametros) {
    this.modalidad = MODALIDADES.DINAMICO;
    this._parametros = parametros;
    this._direccion = validarDireccion(parametros?.direccion ?? DIRECCIONES.MENOR_MEJOR);
    calcularParametrosDinamicos([], parametros); // valida parámetros al construir
  }

  /**
   * @param {number} valor
   * @param {{historial?: Array<{valor: number, fecha: string|Date}>, fecha?: string|Date}} [contexto]
   */
  clasificar(valor, { historial = [], fecha = new Date() } = {}) {
    const estadisticas = calcularParametrosDinamicos(historial, this._parametros, fecha);
    if (!estadisticas.suficiente) {
      return {
        nivel: null,
        motivo: 'datos_insuficientes',
        modalidad: this.modalidad,
        limites: null,
        z: null,
        muestra: { n: estadisticas.n, minimo: this._parametros.minimo_registros },
      };
    }
    const lim = limitesDeParametros({ media: estadisticas.media, desviacion: estadisticas.desviacion, direccion: this._direccion });
    return { ...resultado(this.modalidad, valor, lim), muestra: { n: estadisticas.n, minimo: this._parametros.minimo_registros } };
  }
}

/**
 * Fábrica de estrategias a partir de una fila de `baremos`.
 * @param {{modalidad: string, parametros: object}} baremo
 * @returns {{modalidad: string, clasificar: (valor: number, contexto?: object) => ResultadoClasificacion}}
 */
export function crearEstrategia(baremo) {
  switch (baremo?.modalidad) {
    case MODALIDADES.DINAMICO:
      return new EstrategiaDinamica(baremo.parametros);
    case MODALIDADES.INSTITUCIONAL:
    case MODALIDADES.CIENTIFICO:
      return new EstrategiaEstatica(baremo.modalidad, baremo.parametros);
    default:
      throw baremoInvalido(`Modalidad de baremo desconocida: ${String(baremo?.modalidad)}.`);
  }
}

/**
 * Elige, entre las filas de `baremos`, la vigente en `fecha` para la modalidad
 * y la prueba indicadas (`pruebaId` nulo = baremo del ICO). Dinámico e
 * institucional son de la empresa; científico es global (empresa_id nulo).
 * @param {Array<object>} filas
 * @param {{empresaId: string, modalidad: string, pruebaId?: string|null, fecha?: string|Date}} criterio
 * @returns {object}
 * @throws {ScientificError} Si no hay ninguno vigente.
 */
export function seleccionarBaremoVigente(filas, { empresaId, modalidad, pruebaId = null, fecha = new Date() }) {
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) throw new ScientificError(C.ENTRADA_INVALIDA, 'Fecha de referencia inválida.');
  const duenoEsperado = modalidad === MODALIDADES.CIENTIFICO ? null : empresaId;

  const candidatos = (filas ?? [])
    .filter((b) => {
      const desde = new Date(b.vigente_desde).getTime();
      const hasta = b.vigente_hasta ? new Date(b.vigente_hasta).getTime() : Infinity;
      return (
        b.modalidad === modalidad &&
        (b.empresa_id ?? null) === duenoEsperado &&
        (b.prueba_id ?? null) === pruebaId &&
        desde <= t &&
        t < hasta
      );
    })
    .sort((a, b) => new Date(b.vigente_desde) - new Date(a.vigente_desde));

  if (candidatos.length === 0) {
    throw new ScientificError(C.CONFIGURACION_NO_ENCONTRADA, `No hay baremo "${modalidad}" vigente para la fecha y prueba indicadas.`);
  }
  return candidatos[0];
}

export default { crearEstrategia, seleccionarBaremoVigente, calcularParametrosDinamicos, limitesDeParametros, nivelDeValor, MODALIDADES, NIVELES, DIRECCIONES };
