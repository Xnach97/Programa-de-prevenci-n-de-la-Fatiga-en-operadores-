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
import { CatalogosRepository } from './repositories/catalogos-repository.js';
import { OperadoresRepository } from './repositories/operadores-repository.js';
import { IcoConfiguracionesRepository, BaremosRepository } from './repositories/scientific-repository.js';
import { TestingRepository } from './repositories/testing-repository.js';
import { IndicadoresRepository } from './repositories/indicadores-repository.js';
import { ReglasRepository } from './repositories/rules-repository.js';
import { AuditRepository } from './repositories/audit-repository.js';
import { conCacheLectura } from '../services/read-cache.js';
import { getAlmacenes } from './offline-storage.js';

/** @type {Promise<{usuarios: UsuariosRepository, empresas: EmpresasRepository, catalogos: CatalogosRepository, operadores: OperadoresRepository, ico: IcoConfiguracionesRepository, baremos: BaremosRepository, testing: TestingRepository, indicadores: IndicadoresRepository, reglas: ReglasRepository, auditoria: AuditRepository}> | null} */
let databasePromise = null;

/**
 * Instancia única de la capa de datos, con repositorios ya conectados.
 * @returns {Promise<{usuarios: UsuariosRepository, empresas: EmpresasRepository, catalogos: CatalogosRepository, operadores: OperadoresRepository, ico: IcoConfiguracionesRepository, baremos: BaremosRepository, testing: TestingRepository, indicadores: IndicadoresRepository, reglas: ReglasRepository, auditoria: AuditRepository}>}
 */
export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = getSupabaseClient()
      .then((client) => {
        // Lecturas necesarias para EVALUAR sin conexión: red primero, caché como respaldo (Módulo 9).
        const opciones = { almacen: getAlmacenes().cache };
        const porEmpresa = ([empresaId]) => String(empresaId);
        return {
          usuarios: new UsuariosRepository(client),
          empresas: conCacheLectura(new EmpresasRepository(client), { obtenerConfiguracion: porEmpresa }, opciones),
          catalogos: new CatalogosRepository(client),
          operadores: conCacheLectura(
            new OperadoresRepository(client),
            { obtenerPorUsuario: ([usuarioId]) => String(usuarioId), obtenerActivoPorCedula: ([empresaId, cedula]) => `${empresaId}:${String(cedula).trim()}` },
            opciones,
          ),
          ico: conCacheLectura(new IcoConfiguracionesRepository(client), { listar: porEmpresa }, opciones),
          baremos: conCacheLectura(new BaremosRepository(client), { listar: porEmpresa }, opciones),
          testing: conCacheLectura(new TestingRepository(client), { listarActivas: () => 'activas', historialIco: ([empresaId]) => String(empresaId) }, opciones),
          indicadores: new IndicadoresRepository(client),
          reglas: new ReglasRepository(client),
          auditoria: new AuditRepository(client),
        };
      })
      .catch((error) => {
        databasePromise = null; // permite reintento si la inicialización falló
        throw error;
      });
  }
  return databasePromise;
}

export default { getDatabase };
