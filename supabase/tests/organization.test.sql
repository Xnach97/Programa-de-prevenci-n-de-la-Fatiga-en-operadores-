-- =============================================================================
-- supabase/tests/organization.test.sql
-- Pruebas con aserciones del Módulo 3 (Organization): catálogos, operadores,
-- aislamiento entre empresas, integridad referencial y anonimización.
-- Un fallo aborta con ERROR (psql -v ON_ERROR_STOP=1).
--
-- Precondición: migraciones 0001–0006 aplicadas (y local_stubs.sql si el
-- Postgres no es Supabase). Datos con UUID fijos, eliminados al final.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures (como superusuario, RLS no aplica)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'org-admin1@test'),
  ('a1000000-0000-0000-0000-000000000002', 'org-supervisor1@test'),
  ('a1000000-0000-0000-0000-000000000003', 'org-operador1@test'),
  ('a1000000-0000-0000-0000-000000000004', 'org-admin2@test'),
  ('a1000000-0000-0000-0000-000000000005', 'org-pgr1@test');

insert into empresas (id, nombre, nit) values
  ('c1000000-0000-0000-0000-00000000000a', 'Org Empresa A', 'ORG-A'),
  ('c1000000-0000-0000-0000-00000000000b', 'Org Empresa B', 'ORG-B');

insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'Admin A', 'org-admin1@test'),
  ('a1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'Supervisor A', 'org-supervisor1@test'),
  ('a1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-00000000000a', 'Operador A', 'org-operador1@test'),
  ('a1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-00000000000b', 'Admin B', 'org-admin2@test'),
  ('a1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-00000000000a', 'PGR A', 'org-pgr1@test');

insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a1000000-0000-0000-0000-000000000001', id, 'c1000000-0000-0000-0000-00000000000a' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a1000000-0000-0000-0000-000000000002', id, 'c1000000-0000-0000-0000-00000000000a' from roles where nombre = 'Supervisor SST' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a1000000-0000-0000-0000-000000000003', id, 'c1000000-0000-0000-0000-00000000000a' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a1000000-0000-0000-0000-000000000004', id, 'c1000000-0000-0000-0000-00000000000b' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a1000000-0000-0000-0000-000000000005', id, 'c1000000-0000-0000-0000-00000000000a' from roles where nombre = 'Profesional PGR' and es_plantilla;

-- Catálogos de A y de B
insert into areas (id, empresa_id, nombre) values
  ('d1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Sala de mandos'),
  ('d1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'Mantenimiento B');
insert into cargos (id, empresa_id, nombre, area_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Operador de caldera', 'd1000000-0000-0000-0000-00000000000a');
insert into centros_trabajo (id, empresa_id, nombre) values
  ('f1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Planta 1');

-- Operadores: uno con cuenta propia (vinculado al usuario operador), uno en modo kiosco
insert into operadores (id, empresa_id, usuario_id, cedula, nombre, apellido, cargo_id, area_id) values
  ('b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000003', '1090000001', 'Ana', 'Pérez', 'e1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a'),
  ('b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', null, '1090000002', 'Luis', 'Gómez', null, null);

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

-- ---------------------------------------------------------------------------
-- Admin A: administra catálogos y operadores de SU empresa, nada de la empresa B
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';
do $$
declare v_filas int;
begin
  assert (select count(*) from areas) = 1, 'adminA: solo ve el área de su empresa';
  assert (select count(*) from areas where nombre = 'Mantenimiento B') = 0, 'adminA: NO ve áreas de la empresa B';
  assert (select count(*) from operadores) = 2, 'adminA: ve los 2 operadores de su empresa (operadores.ver)';

  insert into areas (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000a', 'Calidad');
  assert (select count(*) from areas) = 2, 'adminA: puede crear un área en su empresa';

  update areas set estado = 'inactivo' where id = 'd1000000-0000-0000-0000-00000000000a';
  get diagnostics v_filas = row_count;
  assert v_filas = 1, 'adminA: puede desactivar un área de su empresa';

  update areas set nombre = 'Hackeada' where id = 'd1000000-0000-0000-0000-00000000000b';
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'adminA: NO puede modificar áreas de la empresa B (RLS las oculta)';
end $$;
rollback;

-- Admin A no puede insertar filas en la empresa B (with check)
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';
do $$
declare v_bloqueado boolean := false;
begin
  begin
    insert into areas (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000b', 'Intruso');
  exception when insufficient_privilege then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'adminA: insertar un área en la empresa B debe ser BLOQUEADO por RLS';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Integridad referencial: FK compuesta impide fugas entre empresas
-- ---------------------------------------------------------------------------
do $$
declare v_bloqueado boolean := false;
begin
  -- (como superusuario: RLS no aplica, la barrera es la FK compuesta)
  begin
    insert into cargos (empresa_id, nombre, area_id)
    values ('c1000000-0000-0000-0000-00000000000a', 'Cargo con área ajena', 'd1000000-0000-0000-0000-00000000000b');
  exception when foreign_key_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'FK compuesta: un cargo de A NO puede apuntar a un área de B';

  v_bloqueado := false;
  begin
    insert into operadores (empresa_id, cedula, area_id)
    values ('c1000000-0000-0000-0000-00000000000b', '2000000001', 'd1000000-0000-0000-0000-00000000000a');
  exception when foreign_key_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'FK compuesta: un operador de B NO puede apuntar a un área de A';

  -- Relación opcional: un cargo sin área sigue siendo válido.
  insert into cargos (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000a', 'Cargo sin área');
  assert exists (select 1 from cargos where nombre = 'Cargo sin área' and area_id is null), 'FK compuesta: area_id opcional debe seguir permitido';
  delete from cargos where nombre = 'Cargo sin área';
end $$;

-- Un catálogo en uso no se puede borrar (solo desactivar)
do $$
declare v_bloqueado boolean := false;
begin
  begin
    delete from areas where id = 'd1000000-0000-0000-0000-00000000000a';
  exception when foreign_key_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'catálogo en uso: borrar un área referenciada debe ser BLOQUEADO (ON DELETE RESTRICT)';
end $$;

-- Unicidad de nombre por empresa, insensible a mayúsculas; mismo nombre en otra empresa sí es válido
do $$
declare v_bloqueado boolean := false;
begin
  begin
    insert into areas (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000a', '  SALA DE MANDOS ');
  exception when unique_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'unicidad: "  SALA DE MANDOS " duplica "Sala de mandos" (insensible a mayúsculas y espacios)';

  insert into areas (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000b', 'Sala de mandos');
  assert exists (select 1 from areas where empresa_id = 'c1000000-0000-0000-0000-00000000000b' and nombre = 'Sala de mandos'),
    'unicidad: el mismo nombre en OTRA empresa debe ser válido';
  delete from areas where empresa_id = 'c1000000-0000-0000-0000-00000000000b' and nombre = 'Sala de mandos';
end $$;

-- ---------------------------------------------------------------------------
-- Supervisor: ve catálogos y operadores, pero no edita catálogos
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000002';
do $$
declare v_filas int; v_bloqueado boolean := false;
begin
  assert (select count(*) from areas) = 1, 'supervisor: ve los catálogos (catalogos.ver)';
  assert (select count(*) from operadores) = 2, 'supervisor: ve operadores (operadores.ver)';
  begin
    insert into areas (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000a', 'No permitido');
  exception when insufficient_privilege then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'supervisor: NO puede crear catálogos (sin catalogos.editar)';

  -- Sí administra operadores
  update operadores set turno_habitual = 'Nocturno' where id = 'b1000000-0000-0000-0000-000000000002';
  get diagnostics v_filas = row_count;
  assert v_filas = 1, 'supervisor: puede editar operadores (operadores.administrar)';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Operador con cuenta propia: ve solo su fila; lee catálogos; no edita nada
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000003';
do $$
declare v_filas int; v_bloqueado boolean := false;
begin
  assert (select count(*) from operadores) = 1, 'operador: ve solo su propia fila';
  assert (select cedula from operadores) = '1090000001', 'operador: la fila visible es la suya, no la de otro operador';
  assert (select count(*) from areas) = 1, 'operador: lee catálogos (catalogos.ver desde la migración 0006)';

  update operadores set nombre = 'Cambiado' where id = 'b1000000-0000-0000-0000-000000000001';
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'operador: NO puede editar ni su propia fila (sin operadores.administrar)';

  begin
    insert into areas (empresa_id, nombre) values ('c1000000-0000-0000-0000-00000000000a', 'No permitido');
  exception when insufficient_privilege then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'operador: NO puede crear catálogos';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PGR: lee catálogos y operadores, no administra
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000005';
do $$
declare v_filas int;
begin
  assert (select count(*) from areas) = 1, 'pgr: lee catálogos';
  assert (select count(*) from operadores) = 2, 'pgr: lee operadores';
  update operadores set nombre = 'X' where id = 'b1000000-0000-0000-0000-000000000002';
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'pgr: NO administra operadores';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Empresa B no ve nada de A; sin sesión no ve nada
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000004';
do $$
begin
  assert (select count(*) from operadores) = 0, 'adminB: NO ve operadores de la empresa A';
  assert (select count(*) from cargos) = 0, 'adminB: NO ve cargos de la empresa A';
  assert (select count(*) from areas) = 1, 'adminB: ve solo su propia área';
end $$;
rollback;

begin;
set local role app_user;
do $$
begin
  assert (select count(*) from operadores) = 0, 'anon: no ve operadores';
  assert (select count(*) from areas) = 0, 'anon: no ve catálogos';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Los operadores no se borran (no hay política de DELETE)
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';
do $$
declare v_filas int;
begin
  delete from operadores where id = 'b1000000-0000-0000-0000-000000000002';
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'operadores: ni el administrador puede borrar operadores (sin política DELETE)';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Anonimización (Ley 1581): irreversible y sin datos de identificación
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';
do $$
declare v_op operadores%rowtype; v_bloqueado boolean := false;
begin
  update operadores set estado = 'anonimizado' where id = 'b1000000-0000-0000-0000-000000000001';
  select * into v_op from operadores where id = 'b1000000-0000-0000-0000-000000000001';

  assert v_op.estado = 'anonimizado', 'anonimización: el estado queda en anonimizado';
  assert v_op.nombre is null and v_op.apellido is null, 'anonimización: se borran nombre y apellido';
  assert v_op.usuario_id is null, 'anonimización: se desvincula la cuenta de usuario';
  assert v_op.cedula = 'ANON-' || v_op.id::text, 'anonimización: la cédula se reemplaza por un marcador derivado del id';
  assert v_op.cedula <> '1090000001', 'anonimización: la cédula real ya no está';
  assert v_op.fecha_desvinculacion is not null, 'anonimización: se registra la fecha de desvinculación';
  assert v_op.cargo_id is not null, 'anonimización: se conservan cargo y área para las curvas poblacionales';

  begin
    update operadores set estado = 'activo' where id = v_op.id;
  exception when check_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'anonimización: es IRREVERSIBLE (no puede volver a activo)';

  v_bloqueado := false;
  begin
    update operadores set nombre = 'Ana' where id = v_op.id;
  exception when check_violation then
    v_bloqueado := true;
  end;
  assert v_bloqueado, 'anonimización: un registro anonimizado NO admite datos de identificación';
end $$;
rollback;

-- updated_at se mantiene
do $$
declare v_antes timestamptz; v_despues timestamptz;
begin
  select updated_at into v_antes from areas where id = 'd1000000-0000-0000-0000-00000000000a';
  perform pg_sleep(0.05);
  update areas set estado = 'inactivo' where id = 'd1000000-0000-0000-0000-00000000000a';
  select updated_at into v_despues from areas where id = 'd1000000-0000-0000-0000-00000000000a';
  assert v_despues > v_antes, 'updated_at: debe avanzar en cada UPDATE';
end $$;

-- ---------------------------------------------------------------------------
-- Limpieza
-- ---------------------------------------------------------------------------
delete from operadores where empresa_id in ('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b');
delete from cargos where empresa_id in ('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b');
delete from areas where empresa_id in ('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b');
delete from centros_trabajo where empresa_id in ('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b');
delete from usuarios_roles where empresa_id in ('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b');
delete from usuarios where email like 'org-%@test';
delete from empresas where nit in ('ORG-A', 'ORG-B');
delete from auth.users where email like 'org-%@test';

\echo 'ORGANIZATION: TODAS LAS ASERCIONES PASARON'
