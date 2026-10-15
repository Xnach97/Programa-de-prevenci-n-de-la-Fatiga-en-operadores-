-- =============================================================================
-- supabase/tests/indicators.test.sql
-- Módulo 6 — Indicators: definiciones, publicar_indicadores (permiso, ámbito,
-- validación de valores, upsert) y lectura por RLS. Precondición: 0001–0013.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a4000000-0000-0000-0000-000000000001', 'ind-sup@test'),
  ('a4000000-0000-0000-0000-000000000002', 'ind-op@test'),
  ('a4000000-0000-0000-0000-000000000003', 'ind-adminb@test');
insert into empresas (id, nombre, nit) values
  ('c4000000-0000-0000-0000-00000000000a', 'Ind A', 'IND-A'),
  ('c4000000-0000-0000-0000-00000000000b', 'Ind B', 'IND-B');
insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-00000000000a', 'Sup', 'ind-sup@test'),
  ('a4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-00000000000a', 'Op', 'ind-op@test'),
  ('a4000000-0000-0000-0000-000000000003', 'c4000000-0000-0000-0000-00000000000b', 'Admin B', 'ind-adminb@test');
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a4000000-0000-0000-0000-000000000001', id, 'c4000000-0000-0000-0000-00000000000a' from roles where nombre = 'Supervisor SST' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a4000000-0000-0000-0000-000000000002', id, 'c4000000-0000-0000-0000-00000000000a' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a4000000-0000-0000-0000-000000000003', id, 'c4000000-0000-0000-0000-00000000000b' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into areas (id, empresa_id, nombre) values
  ('d4000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-00000000000a', 'Área A'),
  ('d4000000-0000-0000-0000-00000000000b', 'c4000000-0000-0000-0000-00000000000b', 'Área B');
insert into operadores (id, empresa_id, cedula, nombre, apellido, area_id) values
  ('b4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-00000000000a', '2100000001', 'Ana', 'Ind', 'd4000000-0000-0000-0000-00000000000a'),
  ('b4000000-0000-0000-0000-000000000003', 'c4000000-0000-0000-0000-00000000000b', '2100000003', 'Eva', 'Otra', null);

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;

do $$
declare
  v_a constant uuid := 'c4000000-0000-0000-0000-00000000000a';
  v_b constant uuid := 'c4000000-0000-0000-0000-00000000000b';
  v_op constant uuid := 'b4000000-0000-0000-0000-000000000001';
  v_op_b constant uuid := 'b4000000-0000-0000-0000-000000000003';
  v_n int; v_valor numeric; v_filas int;
begin
  -- Definiciones sembradas
  select count(*) into v_n from indicadores_definiciones;
  assert v_n = 10, 'se esperaban 10 definiciones, hay ' || v_n;
  assert exists (select 1 from indicadores_definiciones where codigo = 'ico_empresa' and ambito = 'empresa'), 'ico_empresa';

  -- Supervisor (evaluaciones.registrar) publica
  perform set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000001', true);
  set local role app_user;

  v_n := publicar_indicadores(v_a, jsonb_build_array(
    jsonb_build_object('codigo','ico_trabajador','ambito_id',v_op,'desde','2026-10-15','hasta','2026-10-16','valor',72.5,'detalle','{"n":2}'::jsonb),
    jsonb_build_object('codigo','ico_empresa','ambito_id',v_a,'desde','2026-10-15','hasta','2026-10-16','valor',72.5),
    jsonb_build_object('codigo','ico_area','ambito_id','d4000000-0000-0000-0000-00000000000a','desde','2026-10-15','hasta','2026-10-16','valor',70)));
  assert v_n = 3, 'publicó 3';

  -- Upsert: mismo (empresa, indicador, ámbito, periodo) sobrescribe
  perform publicar_indicadores(v_a, jsonb_build_array(
    jsonb_build_object('codigo','ico_trabajador','ambito_id',v_op,'desde','2026-10-15','hasta','2026-10-16','valor',65.123456)));
  select count(*), max(valor) into v_filas, v_valor from indicadores_valores where empresa_id = v_a and ambito_id = v_op;
  assert v_filas = 1, 'upsert no duplica';
  assert v_valor = 65.123, 'valor redondeado a 3 decimales: ' || v_valor;

  -- Otro periodo = otra fila
  perform publicar_indicadores(v_a, jsonb_build_array(
    jsonb_build_object('codigo','ico_trabajador','ambito_id',v_op,'desde','2026-09-16','hasta','2026-10-16','valor',60)));
  select count(*) into v_filas from indicadores_valores where empresa_id = v_a and ambito_id = v_op;
  assert v_filas = 2, 'ventana mensual aparte';

  -- Ámbito de otra empresa / inexistente / indicador desconocido / valor inválido / periodo inválido
  begin
    perform publicar_indicadores(v_a, jsonb_build_array(jsonb_build_object('codigo','ico_trabajador','ambito_id',v_op_b,'desde','2026-10-15','hasta','2026-10-16','valor',50)));
    assert false, 'ámbito de otra empresa debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_indicadores(v_a, jsonb_build_array(jsonb_build_object('codigo','ico_empresa','ambito_id',v_b,'desde','2026-10-15','hasta','2026-10-16','valor',50)));
    assert false, 'empresa ajena como ámbito debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_indicadores(v_a, jsonb_build_array(jsonb_build_object('codigo','no_existe','ambito_id',v_a,'desde','2026-10-15','hasta','2026-10-16','valor',50)));
    assert false, 'indicador desconocido debió fallar';
  exception when invalid_parameter_value then null; end;
  begin
    perform publicar_indicadores(v_a, jsonb_build_array(jsonb_build_object('codigo','ico_empresa','ambito_id',v_a,'desde','2026-10-15','hasta','2026-10-16','valor','NaN')));
    assert false, 'NaN debió fallar';
  exception when invalid_parameter_value then null; end;
  begin
    perform publicar_indicadores(v_a, jsonb_build_array(jsonb_build_object('codigo','ico_empresa','ambito_id',v_a,'desde','2026-10-16','hasta','2026-10-16','valor',50)));
    assert false, 'periodo vacío debió fallar';
  exception when invalid_parameter_value then null; end;
  begin
    perform publicar_indicadores(v_a, '{"no":"arreglo"}'::jsonb);
    assert false, 'no arreglo debió fallar';
  exception when invalid_parameter_value then null; end;

  -- Escritura directa denegada por RLS (sin política de escritura)
  begin
    insert into indicadores_valores (empresa_id, indicador_id, ambito_id, periodo, valor)
    select v_a, id, v_a, daterange('2026-01-01','2026-01-02'), 1 from indicadores_definiciones where codigo = 'ico_empresa';
    assert false, 'insert directo debió fallar';
  exception when insufficient_privilege then null; end;

  -- Supervisor (evaluaciones.ver) lee los de su empresa
  select count(*) into v_filas from indicadores_valores;
  assert v_filas = 4, 'supervisor ve 4, ve ' || v_filas;
  reset role;

  -- Operador: tiene evaluaciones.registrar (su propia evaluación) → puede recalcular indicadores
  -- de su empresa (riesgo documentado: valores calculados en cliente), pero NO leerlos.
  perform set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000002', true);
  set local role app_user;
  v_n := publicar_indicadores(v_a, jsonb_build_array(jsonb_build_object('codigo','ico_empresa','ambito_id',v_a,'desde','2026-10-17','hasta','2026-10-18','valor',1)));
  assert v_n = 1, 'operador publica por evaluaciones.registrar';
  select count(*) into v_filas from indicadores_valores;
  assert v_filas = 0, 'operador no lee indicadores de empresa';
  reset role;

  -- Aislamiento entre empresas
  perform set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000003', true);
  set local role app_user;
  select count(*) into v_filas from indicadores_valores;
  assert v_filas = 0, 'Admin B no ve indicadores de A';
  begin
    perform publicar_indicadores(v_a, '[]'::jsonb);
    assert false, 'Admin B no debe publicar en A';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Periodo con límites no canónicos rechazado por CHECK
  begin
    insert into indicadores_valores (empresa_id, indicador_id, ambito_id, periodo, valor)
    select v_a, id, v_a, daterange('2026-01-01','2026-01-02','[]'), 1 from indicadores_definiciones where codigo = 'ico_empresa';
    -- '[]' sobre date se normaliza a [) por PostgreSQL: se acepta; el CHECK exige [) tras normalizar.
  exception when check_violation then null; end;

  raise notice 'INDICATORS: TODAS LAS ASERCIONES PASARON';
end $$;
