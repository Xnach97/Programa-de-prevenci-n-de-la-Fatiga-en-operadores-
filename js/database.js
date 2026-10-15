/**
 * @module js/database
 * @description Capa única de acceso a datos — Fase 2 §2: "database.js — capa
 * única de acceso a datos (envuelve supabase-js)".
 *
 * Los módulos de dominio consumen `getDatabase()` y usan los repositorios
 * expuestos aquí. `services/supabase.js` sigue siendo el único lugar donde se
 * instancia el cliente; este módulo es el único donde ese cliente se usa para
 * leer/escribir tablas de negocio, con un repositorio por agregado de dominio
 * (Fase 2 §1, principio 3).
 */

import { getSupabaseClient } from '../services/supabase.js';
import { UsuariosRepository } from './repositories/usuarios-repository.js';
import { EmpresasRepository } from './repositories/empresas-repository.js';

/** @type {Promise<{usuarios: UsuariosRepository, empresas: EmpresasRepository}> | null} */
let databasePromise = null;

/**
 * Instancia única de la capa de datos, con repositorios ya conectados.
 * @returns {Promise<{usuarios: UsuariosRepository, empresas: EmpresasRepository}>}
 */
export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = getSupabaseClient()
      .then((client) => ({
        usuarios: new UsuariosRepository(client),
        empresas: new EmpresasRepository(client),
      }))
      .catch((error) => {
        databasePromise = null; // permite reintento si la inicialización falló
        throw error;
      });
  }
  return databasePromise;
}

export default { getDatabase };
