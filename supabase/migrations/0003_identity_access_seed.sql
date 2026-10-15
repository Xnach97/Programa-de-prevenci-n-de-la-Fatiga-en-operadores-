-- =============================================================================
-- Migración: 0003_identity_access_seed.sql
-- Módulo 2 — Authentication | Seed versionado (Fase 3 §15)
-- =============================================================================
-- Siembra el catálogo base de permisos y los 5 roles de plantilla definidos en
-- Fase 2 §5 con su asignación de permisos por defecto. Estrictamente
-- idempotente. Los módulos futuros amplían el catálogo con su propia
-- migración (permisos.codigo es unique).
-- =============================================================================

insert into permisos (codigo, descripcion, dominio) values
  ('evaluaciones.ver',        'Ver evaluaciones y resultados de pruebas cognitivas', 'evaluaciones'),
  ('evaluaciones.registrar',  'Registrar una evaluación propia',                     'evaluaciones'),
  ('registros.eliminar',      'Marcar registros de evaluación como inválidos',       'evaluaciones'),
  ('configuracion.editar',    'Editar marca, turnos, feature flags de la empresa',   'configuracion'),
  ('baremos.editar',          'Editar pesos de ICO y modalidad de baremo',           'configuracion'),
  ('usuarios.ver',            'Ver usuarios de la empresa',                          'usuarios'),
  ('usuarios.administrar',    'Crear, editar y asignar roles a usuarios',            'usuarios'),
  ('catalogos.ver',           'Ver áreas, cargos, centros de trabajo, procesos',     'catalogos'),
  ('catalogos.editar',        'Editar catálogos organizacionales',                   'catalogos'),
  ('operadores.ver',          'Ver operadores y su historial',                       'operadores'),
  ('operadores.administrar',  'Registrar y editar operadores',                       'operadores'),
  ('datos.exportar',          'Exportar datasets de evaluaciones',                   'investigacion'),
  ('investigacion.acceder',   'Acceder al dashboard científico y cohortes',          'investigacion'),
  ('auditoria.ver',           'Ver el registro de auditoría',                        'auditoria')
on conflict (codigo) do nothing;

do $$
declare
  v_role_id uuid;
begin
  -- Super Administrador — Fase 2 §5: "Todas las empresas." Recibe TODOS los permisos.
  insert into roles (nombre, empresa_id, es_plantilla)
  values ('Super Administrador', null, true)
  on conflict (nombre) where es_plantilla and empresa_id is null do nothing;

  select id into v_role_id from roles where nombre = 'Super Administrador' and es_plantilla and empresa_id is null;

  insert into roles_permisos (role_id, permiso_id)
  select v_role_id, p.id from permisos p
  on conflict (role_id, permiso_id) do nothing;

  -- Administrador de empresa — catálogos, configuración, usuarios de su empresa.
  insert into roles (nombre, empresa_id, es_plantilla)
  values ('Administrador de empresa', null, true)
  on conflict (nombre) where es_plantilla and empresa_id is null do nothing;

  select id into v_role_id from roles where nombre = 'Administrador de empresa' and es_plantilla and empresa_id is null;

  insert into roles_permisos (role_id, permiso_id)
  select v_role_id, p.id from permisos p
  where p.codigo in (
    'usuarios.ver', 'usuarios.administrar',
    'catalogos.ver', 'catalogos.editar',
    'configuracion.editar', 'baremos.editar',
    'evaluaciones.ver',
    'operadores.ver', 'operadores.administrar',
    'auditoria.ver'
  )
  on conflict (role_id, permiso_id) do nothing;

  -- Supervisor SST — dashboard completo, exportes, gestión de operadores.
  insert into roles (nombre, empresa_id, es_plantilla)
  values ('Supervisor SST', null, true)
  on conflict (nombre) where es_plantilla and empresa_id is null do nothing;

  select id into v_role_id from roles where nombre = 'Supervisor SST' and es_plantilla and empresa_id is null;

  insert into roles_permisos (role_id, permiso_id)
  select v_role_id, p.id from permisos p
  where p.codigo in (
    'evaluaciones.ver',
    'datos.exportar',
    'operadores.ver', 'operadores.administrar',
    'catalogos.ver',
    'usuarios.ver'
  )
  on conflict (role_id, permiso_id) do nothing;

  -- Profesional PGR — seguimiento y recomendaciones, sin acceso a configuración.
  insert into roles (nombre, empresa_id, es_plantilla)
  values ('Profesional PGR', null, true)
  on conflict (nombre) where es_plantilla and empresa_id is null do nothing;

  select id into v_role_id from roles where nombre = 'Profesional PGR' and es_plantilla and empresa_id is null;

  insert into roles_permisos (role_id, permiso_id)
  select v_role_id, p.id from permisos p
  where p.codigo in (
    'evaluaciones.ver',
    'operadores.ver'
  )
  on conflict (role_id, permiso_id) do nothing;

  -- Operador — solo su propio flujo. La visibilidad de sus propios registros
  -- se resuelve con la política "usuario_id = auth.uid()" (Fase 3 §13), a
  -- implementar junto con `evaluaciones` en el Módulo Testing Engine.
  insert into roles (nombre, empresa_id, es_plantilla)
  values ('Operador', null, true)
  on conflict (nombre) where es_plantilla and empresa_id is null do nothing;

  select id into v_role_id from roles where nombre = 'Operador' and es_plantilla and empresa_id is null;

  insert into roles_permisos (role_id, permiso_id)
  select v_role_id, p.id from permisos p
  where p.codigo in ('evaluaciones.registrar')
  on conflict (role_id, permiso_id) do nothing;
end $$;
