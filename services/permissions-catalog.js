/**
 * @module services/permissions-catalog
 * @description Catálogo de códigos de permisos — Módulo 2 (Authentication).
 *
 * Espejo en JavaScript de los códigos sembrados en
 * `supabase/migrations/0003_identity_access_seed.sql`. Ningún módulo debe
 * escribir un string de permiso a mano: todos importan `PERMISOS` de aquí,
 * para que un error de tipeo falle en desarrollo (propiedad inexistente) y no
 * silenciosamente en producción. Si una migración futura agrega un permiso,
 * este archivo se actualiza en el mismo commit.
 */

export const PERMISOS = Object.freeze({
  EVALUACIONES_VER: 'evaluaciones.ver',
  EVALUACIONES_REGISTRAR: 'evaluaciones.registrar',
  REGISTROS_ELIMINAR: 'registros.eliminar',
  CONFIGURACION_EDITAR: 'configuracion.editar',
  BAREMOS_EDITAR: 'baremos.editar',
  USUARIOS_VER: 'usuarios.ver',
  USUARIOS_ADMINISTRAR: 'usuarios.administrar',
  CATALOGOS_VER: 'catalogos.ver',
  CATALOGOS_EDITAR: 'catalogos.editar',
  OPERADORES_VER: 'operadores.ver',
  OPERADORES_ADMINISTRAR: 'operadores.administrar',
  DATOS_EXPORTAR: 'datos.exportar',
  INVESTIGACION_ACCEDER: 'investigacion.acceder',
  AUDITORIA_VER: 'auditoria.ver',
});

/** Nombres de los 5 roles de plantilla sembrados (Fase 2 §5). */
export const ROLES_PLANTILLA = Object.freeze({
  SUPER_ADMINISTRADOR: 'Super Administrador',
  ADMINISTRADOR_DE_EMPRESA: 'Administrador de empresa',
  SUPERVISOR_SST: 'Supervisor SST',
  PROFESIONAL_PGR: 'Profesional PGR',
  OPERADOR: 'Operador',
});

export default { PERMISOS, ROLES_PLANTILLA };
