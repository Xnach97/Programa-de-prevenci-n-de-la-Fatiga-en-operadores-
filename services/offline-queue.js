/**
 * @module services/offline-queue
 * @description Cola de evaluaciones pendientes de envío (Módulo 9, Fase 2 §7).
 *
 * Garantías:
 *  - Nada se pierde: el payload se guarda en IndexedDB ANTES de reportar "pendiente".
 *  - Idempotencia: la clave del elemento es `payload.evaluacion_id`; reenviar es
 *    seguro porque `registrar_evaluacion` también es idempotente en el servidor.
 *  - Reintento con retroceso exponencial + jitter para fallos transitorios (red,
 *    5xx, sesión vencida). Los errores PERMANENTES (validación, permisos, RLS) no se
 *    reintentan en bucle: el elemento pasa a `rechazada` y se conserva para revisión.
 *  - Un solo sincronizador a la vez (candado entre pestañas si el navegador lo ofrece).
 *  - Tras un envío real se ejecuta `alSincronizado` (recálculo de indicadores y
 *    reglas), que en el flujo en línea corre al guardar.
 *
 * Sin DOM. El almacén y los relojes se inyectan (probable en Node).
 */

import { createLogger } from './logger.js';

const logger = createLogger('offline-queue');

export const ESTADOS_COLA = Object.freeze({ PENDIENTE: 'pendiente', RECHAZADA: 'rechazada' });
const MS_HORA = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Códigos PostgREST/PG que indican un fallo que NO se arregla reintentando igual. */
const TRANSITORIOS = new Set(['PGRST301', 'PGRST303', '57014', '53300', '40001', '40P01']);

/**
 * ¿Reintentar o no? Sin código de BD (fallo de red, TypeError de fetch, timeout) → transitorio.
 * @param {unknown} error
 * @returns {'transitorio'|'permanente'}
 */
export function clasificarError(error) {
  const causa = error && typeof error === 'object' && 'causaOriginal' in error ? error.causaOriginal : error;
  const codigo = causa && typeof causa === 'object' ? causa.code : undefined;
  const estado = causa && typeof causa === 'object' ? Number(causa.status ?? causa.statusCode) : NaN;
  if (Number.isFinite(estado) && (estado >= 500 || estado === 401 || estado === 408 || estado === 429)) return 'transitorio';
  if (typeof codigo === 'string' && codigo !== '') {
    if (TRANSITORIOS.has(codigo) || /^08/.test(codigo)) return 'transitorio';
    return 'permanente';
  }
  return 'transitorio';
}

/** Almacén en memoria (pruebas y respaldo si IndexedDB no está disponible). */
export function crearAlmacenMemoria(campoClave = 'id') {
  const mapa = new Map();
  return {
    async get(clave) { return mapa.has(clave) ? structuredClone(mapa.get(clave)) : undefined; },
    async put(registro) { mapa.set(registro[campoClave], structuredClone(registro)); },
    async delete(clave) { mapa.delete(clave); },
    async getAll() { return [...mapa.values()].map((v) => structuredClone(v)); },
    async clear() { mapa.clear(); },
  };
}

/**
 * Almacén sobre IndexedDB (un object store por almacén, con `keyPath`).
 * @param {{base?: string, tienda: 'cola'|'cache'}} p
 */
export function crearAlmacenIndexedDB({ base = 'neurolab-offline', tienda }) {
  let abierta = null;
  const abrir = () => {
    if (!abierta) {
      abierta = new Promise((resolver, rechazar) => {
        const peticion = indexedDB.open(base, 1);
        peticion.onupgradeneeded = () => {
          for (const [nombre, kp] of [['cola', 'id'], ['cache', 'clave']]) {
            if (!peticion.result.objectStoreNames.contains(nombre)) peticion.result.createObjectStore(nombre, { keyPath: kp });
          }
        };
        peticion.onsuccess = () => resolver(peticion.result);
        peticion.onerror = () => { abierta = null; rechazar(peticion.error); };
      });
    }
    return abierta;
  };
  const operar = async (modo, accion) => {
    const db = await abrir();
    return new Promise((resolver, rechazar) => {
      const tx = db.transaction(tienda, modo);
      const req = accion(tx.objectStore(tienda));
      tx.oncomplete = () => resolver(req?.result);
      tx.onerror = () => rechazar(tx.error);
      tx.onabort = () => rechazar(tx.error);
    });
  };
  return {
    get: (k) => operar('readonly', (s) => s.get(k)),
    put: (registro) => operar('readwrite', (s) => s.put(registro)),
    delete: (k) => operar('readwrite', (s) => s.delete(k)),
    getAll: () => operar('readonly', (s) => s.getAll()),
    clear: () => operar('readwrite', (s) => s.clear()),
  };
}

export class OfflineQueue {
  /**
   * @param {{
   *   almacen: ReturnType<typeof crearAlmacenMemoria>,
   *   enviar: (payload: object) => Promise<object>,
   *   alSincronizado?: ((item: object, respuesta: object) => Promise<void>)|null,
   *   ahora?: () => number, azar?: () => number,
   *   retardoBaseMs?: number, retardoMaxMs?: number, umbralAlertaMs?: number,
   *   conCandado?: (fn: () => Promise<any>) => Promise<any>
   * }} deps
   */
  constructor({ almacen, enviar, alSincronizado = null, ahora = () => Date.now(), azar = Math.random, retardoBaseMs = 5_000, retardoMaxMs = 300_000, umbralAlertaMs = 4 * MS_HORA, conCandado = null }) {
    if (!almacen || typeof enviar !== 'function') throw new TypeError('OfflineQueue requiere almacen y enviar().');
    this._almacen = almacen;
    this._enviar = enviar;
    this._alSincronizado = alSincronizado;
    this._ahora = ahora;
    this._azar = azar;
    this._base = retardoBaseMs;
    this._max = retardoMaxMs;
    this.umbralAlertaMs = umbralAlertaMs;
    this._conCandado = conCandado ?? ((fn) => fn());
    this._enCurso = null;
    this._oyentes = new Set();
    this._timer = null;
  }

  /** @param {() => void} fn @returns {() => void} desuscribir */
  suscribir(fn) {
    this._oyentes.add(fn);
    return () => this._oyentes.delete(fn);
  }

  _notificar() {
    for (const fn of this._oyentes) {
      try { fn(); } catch (error) { logger.warn('Oyente de cola falló', { error: String(error) }); }
    }
  }

  /** Retardo antes del intento n (n ≥ 1): base·2^(n-1), tope, ±20 % de jitter. */
  retardo(intentos) {
    const bruto = Math.min(this._max, this._base * 2 ** Math.max(intentos - 1, 0));
    return Math.round(bruto * (0.8 + 0.4 * this._azar()));
  }

  /**
   * Guarda el payload. Si ya existe (mismo evaluacion_id) no lo duplica ni lo reinicia.
   * @param {object} payload Debe traer `evaluacion_id` UUID.
   * @param {object} [contexto] Datos para el post-registro (no se envían al servidor).
   */
  async encolar(payload, contexto = {}) {
    const id = payload?.evaluacion_id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('El payload requiere evaluacion_id UUID.');
    if (await this._almacen.get(id)) return { evaluacion_id: id, encolada: true, yaExistia: true };
    const ahora = this._ahora();
    await this._almacen.put({ id, payload, contexto, creado_en: ahora, intentos: 0, proximo_intento: ahora, estado: ESTADOS_COLA.PENDIENTE, ultimo_error: null });
    this._notificar();
    return { evaluacion_id: id, encolada: true, yaExistia: false };
  }

  async _todos() {
    return (await this._almacen.getAll()).sort((a, b) => a.creado_en - b.creado_en);
  }

  /**
   * Envía los elementos vencidos, en orden de creación. Un solo ciclo a la vez.
   * @param {{forzar?: boolean}} [opciones] `forzar` ignora el retroceso (p. ej. al volver la conexión).
   * @returns {Promise<{enviadas: number, pendientes: number, rechazadas: number}>}
   */
  sincronizar({ forzar = false } = {}) {
    if (this._enCurso) return this._enCurso;
    this._enCurso = this._conCandado(() => this._ciclo(forzar))
      .then((r) => r ?? { enviadas: 0, pendientes: 0, rechazadas: 0 })
      .finally(() => { this._enCurso = null; });
    return this._enCurso;
  }

  async _ciclo(forzar) {
    let enviadas = 0;
    for (const item of await this._todos()) {
      if (item.estado !== ESTADOS_COLA.PENDIENTE) continue;
      if (!forzar && item.proximo_intento > this._ahora()) continue;
      try {
        const respuesta = await this._enviar(item.payload);
        await this._almacen.delete(item.id);
        enviadas += 1;
        if (this._alSincronizado) {
          try { await this._alSincronizado(item, respuesta); } catch (error) { logger.warn('Post-registro falló tras sincronizar', { error: String(error) }); }
        }
      } catch (error) {
        const tipo = clasificarError(error);
        const intentos = item.intentos + 1;
        await this._almacen.put({
          ...item,
          intentos,
          ultimo_error: tipo === 'permanente' ? String(error?.causaOriginal?.code ?? 'error') : 'red',
          estado: tipo === 'permanente' ? ESTADOS_COLA.RECHAZADA : ESTADOS_COLA.PENDIENTE,
          proximo_intento: this._ahora() + this.retardo(intentos),
        });
        logger.warn('Envío diferido falló', { tipo, intentos });
        if (tipo === 'transitorio' && !forzar) {
          // Sin red: el retroceso es de TODA la cola (no insistir con el resto en este ciclo ni en el siguiente).
          const hasta = this._ahora() + this.retardo(intentos);
          for (const otro of await this._todos()) {
            if (otro.estado === ESTADOS_COLA.PENDIENTE && otro.id !== item.id && otro.proximo_intento < hasta) await this._almacen.put({ ...otro, proximo_intento: hasta });
          }
          break;
        }
      }
    }
    this._notificar();
    const e = await this.estado();
    return { enviadas, pendientes: e.pendientes, rechazadas: e.rechazadas };
  }

  /** @returns {Promise<{pendientes: number, rechazadas: number, masAntiguaMs: number, vencida: boolean}>} */
  async estado() {
    const todos = await this._todos();
    const pend = todos.filter((i) => i.estado === ESTADOS_COLA.PENDIENTE);
    const rech = todos.filter((i) => i.estado === ESTADOS_COLA.RECHAZADA);
    const masAntigua = todos.length ? this._ahora() - todos[0].creado_en : 0;
    return { pendientes: pend.length, rechazadas: rech.length, masAntiguaMs: masAntigua, vencida: pend.length > 0 && masAntigua >= this.umbralAlertaMs };
  }

  /** Devuelve las rechazadas a pendientes (p. ej. tras corregir permisos). */
  async reintentarRechazadas() {
    for (const item of await this._todos()) {
      if (item.estado === ESTADOS_COLA.RECHAZADA) await this._almacen.put({ ...item, estado: ESTADOS_COLA.PENDIENTE, proximo_intento: this._ahora() });
    }
    this._notificar();
  }

  async descartarRechazadas() {
    for (const item of await this._todos()) if (item.estado === ESTADOS_COLA.RECHAZADA) await this._almacen.delete(item.id);
    this._notificar();
  }

  /** Programa sincronizaciones periódicas y al recuperar la conexión. */
  iniciar({ cadaMs = 30_000, ventana = globalThis } = {}) {
    this.detener();
    const intentar = (forzar) => this.sincronizar({ forzar }).catch((error) => logger.warn('Sincronización falló', { error: String(error) }));
    this._alVolverRed = () => intentar(true);
    ventana.addEventListener?.('online', this._alVolverRed);
    this._ventana = ventana;
    this._timer = setInterval(() => intentar(false), cadaMs);
    intentar(false);
  }

  detener() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._alVolverRed) this._ventana?.removeEventListener?.('online', this._alVolverRed);
    this._alVolverRed = null;
  }
}

/**
 * Función `guardar` para EvaluacionService: intenta enviar; si no hay conexión o el
 * fallo es transitorio, encola y responde `{encolada: true}`. Los fallos permanentes se propagan.
 * @param {{cola: OfflineQueue, enviar: (payload: object) => Promise<object>, estaEnLinea?: () => boolean}} p
 */
export function crearGuardadoConCola({ cola, enviar, estaEnLinea = () => globalThis.navigator?.onLine !== false }) {
  return async (payload, contexto = {}) => {
    const encolar = () => cola.encolar(payload, contexto).then((r) => ({ evaluacion_id: r.evaluacion_id, duplicada: false, encolada: true }));
    if (!estaEnLinea()) return encolar();
    try {
      return await enviar(payload);
    } catch (error) {
      if (clasificarError(error) === 'permanente') throw error;
      try {
        return await encolar();
      } catch (errorCola) {
        logger.error('No se pudo encolar la evaluación', { error: String(errorCola) });
        throw error;
      }
    }
  };
}

export default { OfflineQueue, crearGuardadoConCola, clasificarError, crearAlmacenMemoria, crearAlmacenIndexedDB, ESTADOS_COLA };
