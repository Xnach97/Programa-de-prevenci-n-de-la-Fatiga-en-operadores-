-- =============================================================================
-- supabase/tests/rls.test.sql
-- Pruebas de RLS / RBAC del Módulo 2 (Identity & Access) con aserciones.
-- Cualquier fallo aborta con ERROR (psql -v ON_ERROR_STOP=1), no requiere
-- revisar resultados a ojo.
--
-- Precondición: migraciones 0001–0003 aplicadas (y local_stubs.sql si el
-- Postgres no es Supabase). Usa datos con UUID fijos y los elimina al final.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Datos de prueba (como superusuario, RLS no aplica)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin1@test'),
  ('22222222-2222-2222-2222-222222222222', 'operador1@test'),
  ('33333333-3333-3333-3333-333333333333', 'admin2@test'),
  ('44444444-4444-4444-4444-444444444444', 'superadmin@test');

insert into empresas (id, nombre, nit) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Empresa Uno', 'TEST-001'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa Dos', 'TEST-002');

insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Uno', 'admin1@test'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Operador Uno', 'operador1@test'),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Admin Dos', 'admin2@test'),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Super Admin', 'superadmin@test');

insert into usuarios_roles (usuario_id, role_id, empresa_id)
select '11111111-1111-1111-1111-111111111111', id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select '22222222-2222-2222-2222-222222222222', id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select '33333333-3333-3333-3333-333333333333', id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select '44444444-4444-4444-4444-444444444444', id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from roles where nombre = 'Super Administrador' and es_plantilla;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

-- ---------------------------------------------------------------------------
-- Seed: 5 roles de plantilla, 15 permisos, y asignaciones esperadas
-- ---------------------------------------------------------------------------
do $$
begin
  assert (select count(*) from permisos) = 15, 'seed: deben existir 15 permisos';
  assert (select count(*) from roles where es_plantilla and empresa_id is null) = 5, 'seed: deben existir 5 roles de plantilla';
  assert (select count(*) from roles_permisos rp join roles r on r.id = rp.role_id where r.nombre = 'Super Administrador') = 15, 'seed: Super Administrador debe tener los 15 permisos';
  assert exists (
    select 1 from roles_permisos rp join roles r on r.id = rp.role_id join permisos p on p.id = rp.permiso_id
    where r.nombre = 'Operador' and r.es_plantilla and p.codigo = 'evaluaciones.registrar'
  ), 'seed: Operador debe poder registrar evaluaciones';
  assert (select count(*) from roles_permisos rp join roles r on r.id = rp.role_id where r.nombre = 'Operador' and r.es_plantilla) = 2,
    'seed: Operador debe tener 2 permisos (evaluaciones.registrar y catalogos.ver, este último desde la migración 0006)';
  assert not exists (
    select 1 from roles_permisos rp join roles r on r.id = rp.role_id join permisos p on p.id = rp.permiso_id
    where r.nombre in ('Operador', 'Profesional PGR') and p.codigo in ('configuracion.editar', 'usuarios.administrar', 'baremos.editar')
  ), 'seed: Operador/PGR no deben tener permisos de configuración ni administración';
end $$;

-- ---------------------------------------------------------------------------
-- Admin de la empresa 1: ve lo suyo, no lo de la empresa 2
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
begin
  assert (select count(*) from empresas) = 1, 'admin1: debe ver solo 1 empresa';
  assert (select count(*) from empresas where nit = 'TEST-002') = 0, 'admin1: NO debe ver la empresa 2 (aislamiento multi-tenant)';
  assert (select count(*) from configuracion_empresa) = 1, 'admin1: debe ver solo la configuración de su empresa';
  assert (select count(*) from usuarios) = 3, 'admin1: debe ver los 3 usuarios de su empresa (usuarios.ver) y ninguno de la empresa 2';
  assert (select count(*) from usuarios where email = 'admin2@test') = 0, 'admin1: NO debe ver usuarios de la empresa 2';
  assert tiene_permiso('configuracion.editar', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'admin1: debe tener configuracion.editar en su empresa';
  assert not tiene_permiso('configuracion.editar', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'admin1: NO debe tener permisos en la empresa 2';
  assert not tiene_permiso('registros.eliminar', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'admin1: no tiene registros.eliminar';
  assert not es_super_administrador(), 'admin1: no es super administrador';
end $$;
-- Puede editar la configuración de su empresa (1 fila afectada)...
do $$
declare v_filas int;
begin
  update configuracion_empresa set baremo_modalidad = 'institucional' where empresa_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics v_filas = row_count;
  assert v_filas = 1, 'admin1: debe poder editar la configuración de su empresa';
  -- ...pero no la de otra empresa (0 filas: RLS la oculta).
  update configuracion_empresa set baremo_modalidad = 'institucional' where empresa_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'admin1: NO debe poder editar la configuración de la empresa 2';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Operador: solo se ve a sí mismo, no edita nada, no puede escalar privilegios
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare v_filas int;
begin
  assert (select count(*) from usuarios) = 1, 'operador: debe verse solo a sí mismo';
  assert not tiene_permiso('configuracion.editar', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'operador: no debe poder editar configuración';
  assert not tiene_permiso('usuarios.administrar', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'operador: no debe administrar usuarios';
  assert tiene_permiso('evaluaciones.registrar', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'operador: debe poder registrar evaluaciones';

  update configuracion_empresa set baremo_modalidad = 'cientifico' where empresa_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'operador: UPDATE de configuración debe afectar 0 filas';
end $$;
-- Escalada de privilegios: auto-asignarse el rol de administrador debe FALLAR.
do $$
declare v_bloqueado boolean := false;
begin
  begin
    insert into usuarios_roles (usuario_id, role_id, empresa_id)
    select '22222222-2222-2222-2222-222222222222', id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    from roles where nombre = 'Administrador de empresa' and es_plantilla;
  exception when insufficient_privilege or check_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'operador: la auto-asignación de rol (escalada de privilegios) debe ser BLOQUEADA por RLS';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Admin de la empresa 2 no ve nada de la empresa 1
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
begin
  assert (select count(*) from empresas) = 1, 'admin2: debe ver solo su empresa';
  assert (select count(*) from usuarios) = 1, 'admin2: debe ver solo su propio usuario (sin acceso cruzado)';
  assert (select count(*) from usuarios_roles where empresa_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0, 'admin2: NO debe ver asignaciones de la empresa 1';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Super Administrador: ve todas las empresas
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$
begin
  assert es_super_administrador(), 'superadmin: debe ser reconocido como super administrador';
  assert (select count(*) from empresas) = 2, 'superadmin: debe ver las 2 empresas';
  assert (select count(*) from usuarios) = 4, 'superadmin: debe ver los 4 usuarios';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Sin sesión (anon): no ve nada
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
-- sin request.jwt.claim.sub => auth.uid() es null => auth.role() = 'anon'
do $$
begin
  assert (select count(*) from empresas) = 0, 'anon: no debe ver empresas';
  assert (select count(*) from usuarios) = 0, 'anon: no debe ver usuarios';
  assert (select count(*) from configuracion_empresa) = 0, 'anon: no debe ver configuración';
  assert (select count(*) from permisos) = 0, 'anon: no debe ver el catálogo de permisos';
  assert (select count(*) from usuarios_roles) = 0, 'anon: no debe ver asignaciones de rol';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Trigger: una empresa nueva recibe su configuración por defecto
-- ---------------------------------------------------------------------------
do $$
begin
  assert (select count(*) from configuracion_empresa where empresa_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) = 2,
    'trigger: cada empresa debe tener su fila de configuración por defecto';
  assert (select baremo_modalidad from configuracion_empresa where empresa_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 'dinamico',
    'trigger: el baremo por defecto debe ser dinámico';
end $$;

-- ---------------------------------------------------------------------------
-- Limpieza
-- ---------------------------------------------------------------------------
delete from usuarios_roles where empresa_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
delete from usuarios where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
delete from empresas where nit in ('TEST-001','TEST-002');
delete from auth.users where email like '%@test';

\echo 'RLS: TODAS LAS ASERCIONES PASARON'
