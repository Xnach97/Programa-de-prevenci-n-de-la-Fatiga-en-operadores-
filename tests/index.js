/**
 * @module tests/index
 * @description Importar este módulo registra las 4 pruebas en `testRegistry`.
 * Una prueba nueva = un archivo en `/tests` + una línea aquí + una fila en
 * `pruebas`/`pruebas_versiones` (sin cambios de esquema).
 */
import './attention.js';
import './stroop.js';
import './memory.js';
import './reaction.js';

export { testRegistry } from './test-registry.js';
