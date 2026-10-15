-- =============================================================================
-- supabase/tests/audit.test.sql
-- Módulo 7 — Audit: triggers en tablas sensibles, privacidad del detalle,
-- append-only (incluso para el dueño), RLS y registrar_auditoria.
-- Precondición: migraciones 0001–0016.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a6000000-0000-0000-0000-000000000001', 'au-adm@test'),
  ('a6000000-0000-0000-0000-000000000002', 'au-op@test'),
  ('a6000000-0000-0000-0000-000000000003', 'au-adminb@test');
insert into empresas (id, nombre, nit) values
  ('c6000000-0000-0000-0000-00000000000a', 'Au A', 'AU-A'),
  ('c6000000-0000-0000-0000-00000000000b', 'Au B', 'AU-B');
insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-00000000000a', 'Admin A', 'au-adm@test'),
  ('a6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-00000000000a', 'Op A', 'au-op@test'),
  ('a6000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-00000000000b', 'Admin B', 'au-adminb@test');
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a6000000-0000-0000-0000-000000000001', id, 'c6000000-0000-0000-0000-00000000000a' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a6000000-0000-0000-0000-000000000002', id, 'c6000000-0000-0000-0000-00000000000a' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a6000000-0000-0000-0000-000000000003', id, 'c6000000-0000-0000-0000-00000000000b' from roles where nombre = 'Administrador de empresa' and es_plantilla;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;

do $$
declare
  v_a constant uuid := 'c6000000-0000-0000-0000-00000000000a';
  v_b constant uuid := 'c6000000-0000-0000-0000-00000000000b';
  v_adm constant uuid := 'a6000000-0000-0000-0000-000000000001';
  v_op uuid := 'b6000000-0000-0000-0000-000000000001';
  v_n int; v_fila auditoria%rowtype;
begin
  -- La asignación de roles de arriba ya quedó auditada (usuarios_roles)
  select count(*) into v_n from auditoria where entidad = 'usuarios_roles' and accion = 'usuarios_roles.insert' and empresa_id in (v_a, v_b);
  assert v_n = 3, 'usuarios_roles insert auditado: ' || v_n;
  assert exists (select 1 from auditoria where entidad = 'usuarios_roles' and entidad_id = v_adm), 'entidad_id = usuario_id';

  -- Cambios hechos como Admin A (usuario_id e ip en el registro)
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', true);
  set local role app_user;

  insert into operadores (id, empresa_id, cedula, nombre, apellido) values (v_op, v_a, '2300000001', 'Ana', 'Auditada');
  update configuracion_empresa set turnos = '[{"nombre":"Diurno","hora_inicio":"06:00","hora_fin":"18:00"}]'::jsonb where empresa_id = v_a;
  reset role;

  select * into v_fila from auditoria where entidad = 'operadores' and accion = 'operadores.insert' and entidad_id = v_op;
  assert found, 'insert de operador auditado';
  assert v_fila.empresa_id = v_a and v_fila.usuario_id = v_adm, 'empresa y usuario del actor';
  assert v_fila.ip = '203.0.113.9', 'IP de origen: ' || coalesce(v_fila.ip, 'null');
  assert not (v_fila.detalle_nuevo ? 'cedula') and not (v_fila.detalle_nuevo ? 'nombre') and not (v_fila.detalle_nuevo ? 'apellido'),
    'la auditoría de operadores NO guarda cédula, nombre ni apellido';
  assert v_fila.detalle_nuevo ? 'empresa_id', 'conserva datos no personales';

  select * into v_fila from auditoria where entidad = 'configuracion_empresa' and accion = 'configuracion_empresa.update' and empresa_id = v_a;
  assert found and v_fila.detalle_anterior->'turnos' = '[]'::jsonb and jsonb_array_length(v_fila.detalle_nuevo->'turnos') = 1, 'update de configuración con antes y después';
  assert v_fila.entidad_id = v_a, 'entidad_id de configuracion_empresa = empresa_id';

  -- Anonimizar: queda registrado el cambio de estado, sin datos personales
  update operadores set estado = 'anonimizado' where id = v_op;
  select * into v_fila from auditoria where accion = 'operadores.update' and entidad_id = v_op order by created_at desc limit 1;
  assert v_fila.detalle_nuevo->>'estado' = 'anonimizado' and not (v_fila.detalle_nuevo ? 'cedula'), 'anonimización auditada sin PII';
  assert not exists (select 1 from auditoria where entidad = 'operadores' and (detalle_nuevo::text like '%Auditada%' or detalle_anterior::text like '%Auditada%' or detalle_nuevo::text like '%2300000001%')),
    'ningún registro de auditoría contiene la identidad del operador';

  -- Un UPDATE sin cambios reales no genera ruido
  select count(*) into v_n from auditoria where entidad = 'configuracion_empresa' and empresa_id = v_a;
  update configuracion_empresa set turnos = turnos where empresa_id = v_a;
  assert (select count(*) from auditoria where entidad = 'configuracion_empresa' and empresa_id = v_a) = v_n, 'sin cambios → sin registro';

  -- Versionado científico auditado
  perform publicar_ico_configuracion(v_a, null, '{"atencion_cancelacion":1}'::jsonb);
  assert exists (select 1 from auditoria where entidad = 'ico_configuraciones' and accion = 'ico_configuraciones.insert' and empresa_id = v_a), 'ico_configuraciones auditado';

  -- Append-only: ni el dueño de la tabla puede alterar o borrar
  begin
    update auditoria set accion = 'falsificada.accion';
    assert false, 'UPDATE debió fallar';
  exception when insufficient_privilege then null; end;
  begin
    delete from auditoria;
    assert false, 'DELETE debió fallar';
  exception when insufficient_privilege then null; end;
  begin
    truncate auditoria;
    assert false, 'TRUNCATE debió fallar';
  exception when insufficient_privilege then null; end;

  -- RLS
  set local role app_user;
  select count(*) into v_n from auditoria;
  assert v_n > 0 and not exists (select 1 from auditoria where empresa_id is distinct from v_a), 'Admin A solo ve su empresa';
  begin
    insert into auditoria (empresa_id, accion, entidad) values (v_a, 'falsa.accion', 'x');
    assert false, 'insert directo debió fallar';
  exception when insufficient_privilege then null; end;
  update auditoria set accion = 'falsificada.accion';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'sin política de UPDATE: RLS no deja tocar ninguna fila';
  delete from auditoria;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'sin política de DELETE: RLS no deja borrar ninguna fila';
  perform registrar_auditoria(v_a, 'dataset.exportar', 'datasets_exportados', null, '{"filas":10}'::jsonb);
  assert exists (select 1 from auditoria where accion = 'dataset.exportar' and usuario_id = v_adm and detalle_nuevo->>'filas' = '10'), 'registrar_auditoria explícito';
  begin
    perform registrar_auditoria(v_b, 'dataset.exportar', 'x');
    assert false, 'auditar en empresa ajena debió fallar';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
  set local role app_user;
  select count(*) into v_n from auditoria;
  assert v_n = 0, 'Operador no ve auditoría';
  reset role;

  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000003', true);
  set local role app_user;
  select count(*) into v_n from auditoria where empresa_id = v_a;
  assert v_n = 0, 'Admin B no ve la auditoría de A';
  reset role;

  raise notice 'AUDIT: TODAS LAS ASERCIONES PASARON';
end $$;
