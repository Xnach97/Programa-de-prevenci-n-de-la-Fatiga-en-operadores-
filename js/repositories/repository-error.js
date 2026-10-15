/**
 * @module js/repositories/repository-error
 * @description Error tipado de la capa de acceso a datos.
 *
 * Todos los repositorios envuelven los errores crudos de `supabase-js` en
 * `RepositoryError`, dando a las capas superiores un tipo estable sin
 * acoplarse a la forma interna del SDK.
 */

export class RepositoryError extends Error {
  /**
   * @param {string} operacion - Ej. 'usuarios.obtenerPerfilCompleto'.
   * @param {unknown} causaOriginal - Error crudo del SDK subyacente.
   */
  constructor(operacion, causaOriginal) {
    const mensajeCausa =
      causaOriginal && typeof causaOriginal === 'object' && 'message' in causaOriginal
        ? String(causaOriginal.message)
        : String(causaOriginal);
    super(`Fallo en operación de datos "${operacion}": ${mensajeCausa}`);
    this.name = 'RepositoryError';
    this.operacion = operacion;
    this.causaOriginal = causaOriginal;
  }
}

export default RepositoryError;
