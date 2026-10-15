/**
 * @module js/state-store
 * @description Fábrica de estado encapsulado y observable — Core Platform (Módulo 1).
 *
 * Responsabilidad única: proveer un contenedor de estado inmutable con
 * suscripción a cambios, para que cada módulo mantenga SU PROPIO estado
 * encapsulado en vez de leer/escribir variables globales compartidas
 * (`estado`, `p1Data`, `p2Data`, `p3Data`, `chartCache`, `todosLosDatos` —
 * anti-patrón documentado en Fase 1 §1.2 #8 y prohibido explícitamente en
 * Fase 2 §6, último punto).
 *
 * Cada módulo que necesite estado (navigation.js, theming.js, y en módulos
 * futuros: tests/*.js, dashboard/*.js) crea SU PROPIA instancia con
 * `createStore()`. No existe un store global de aplicación importado por
 * todos — eso recrearía el mismo problema con otro nombre.
 */

/**
 * Congela un valor de forma superficial. Se usa superficial (no profunda)
 * deliberadamente: forzar inmutabilidad profunda de estructuras grandes
 * (por ejemplo, resultados de pruebas con arrays de eventos) tendría un
 * costo de rendimiento no justificado en Fase 1 de la plataforma; la
 * disciplina de "reemplazar, no mutar" en `setState` es suficiente
 * contrato para los módulos consumidores.
 * @template T
 * @param {T} value
 * @returns {Readonly<T>}
 */
function shallowFreeze(value) {
  return Object.freeze({ ...value });
}

/**
 * @template TState
 * @typedef {Object} Store
 * @property {() => Readonly<TState>} getState
 * @property {(updater: Partial<TState> | ((current: Readonly<TState>) => Partial<TState>)) => void} setState
 * @property {(listener: (state: Readonly<TState>, previousState: Readonly<TState>) => void) => () => void} subscribe
 * @property {() => void} reset
 */

/**
 * Crea un store aislado con estado inicial dado.
 * @template TState
 * @param {TState} initialState
 * @returns {Store<TState>}
 */
export function createStore(initialState) {
  if (initialState === null || typeof initialState !== 'object') {
    throw new TypeError('createStore requiere un objeto de estado inicial.');
  }

  const initialSnapshot = shallowFreeze(initialState);
  let state = initialSnapshot;
  /** @type {Set<(state: unknown, previousState: unknown) => void>} */
  const listeners = new Set();

  /** @returns {Readonly<TState>} */
  function getState() {
    return state;
  }

  /**
   * Reemplaza parcialmente el estado (merge superficial) y notifica a los
   * suscriptores. Acepta un objeto parcial o una función `(estadoActual) =>
   * parcial`, útil cuando el nuevo valor depende del anterior.
   * @param {Partial<TState> | ((current: Readonly<TState>) => Partial<TState>)} updater
   */
  function setState(updater) {
    const previousState = state;
    const partial = typeof updater === 'function' ? updater(state) : updater;
    if (partial === null || typeof partial !== 'object') {
      throw new TypeError('setState requiere un objeto parcial o una función que devuelva uno.');
    }
    state = shallowFreeze({ ...state, ...partial });
    for (const listener of listeners) {
      listener(state, previousState);
    }
  }

  /**
   * Suscribe un listener a cambios de estado.
   * @param {(state: Readonly<TState>, previousState: Readonly<TState>) => void} listener
   * @returns {() => void} función de desuscripción.
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe requiere un listener de tipo función.');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Restaura el store a su estado inicial y notifica a los suscriptores. */
  function reset() {
    setState(() => initialSnapshot);
  }

  return { getState, setState, subscribe, reset };
}

export default createStore;
