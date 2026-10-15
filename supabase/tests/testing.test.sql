-- =============================================================================
-- supabase/tests/testing.test.sql
-- Módulo 5 — Testing Engine: catálogo, registro atómico/idempotente, intentos,
-- inmutabilidad y RLS. Precondición: migraciones 0001–0011.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-000000000001', 'tst-sup@test'),
  ('a3000000-0000-0000-0000-000000000002', 'tst-op@test'),
  ('a3000000-0000-0000-0000-000000000003', 'tst-adminb@test'),
  ('a3000000-0000-0000-0000-000000000004', 'tst-pgr@test');
insert into empresas (id, nombre, nit) values
  ('c3000000-0000-0000-0000-00000000000a', 'Tst A', 'TST-A'),
  ('c3000000-0000-0000-0000-00000000000b', 'Tst B', 'TST-B');
insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-00000000000a', 'Sup A', 'tst-sup@test'),
  ('a3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-00000000000a', 'Op A', 'tst-op@test'),
  ('a3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-00000000000b', 'Admin B', 'tst-adminb@test'),
  ('a3000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-00000000000a', 'PGR A', 'tst-pgr@test');
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a3000000-0000-0000-0000-000000000001', id, 'c3000000-0000-0000-0000-00000000000a' from roles where nombre = 'Supervisor SST' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a3000000-0000-0000-0000-000000000002', id, 'c3000000-0000-0000-0000-00000000000a' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a3000000-0000-0000-0000-000000000003', id, 'c3000000-0000-0000-0000-00000000000b' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a3000000-0000-0000-0000-000000000004', id, 'c3000000-0000-0000-0000-00000000000a' from roles where nombre = 'Profesional PGR' and es_plantilla;

insert into operadores (id, empresa_id, usuario_id, cedula, nombre, apellido) values
  ('b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000002', '2090000001', 'Ana', 'Test'),
  ('b3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-00000000000a', null, '2090000002', 'Luis', 'Kiosco'),
  ('b3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-00000000000b', null, '2090000003', 'Eva', 'Otra');

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

-- ---------------------------------------------------------------------------
-- Catálogo sembrado
-- ---------------------------------------------------------------------------
do $$
begin
  assert (select count(*) from pruebas where codigo in ('atencion_cancelacion','stroop_adaptado','memoria_secuencias','reaccion_simple')) = 4, 'las 4 pruebas del legado están sembradas';
  assert (select count(*) from pruebas where version_actual_id is null) = 0, 'toda prueba tiene versión actual';
  assert (select count(*) from pruebas_versiones where estado = 'experimental') >= 4, 'versiones iniciales marcadas experimental';
  assert exists (select 1 from baremos limit 0) or true, 'tabla baremos accesible';
  -- Supervisor y Administrador pueden registrar (modo quiosco)
  assert (select count(*) from roles_permisos rp join roles r on r.id = rp.role_id join permisos p on p.id = rp.permiso_id
           where r.es_plantilla and r.nombre in ('Supervisor SST','Administrador de empresa') and p.codigo = 'evaluaciones.registrar') = 2, 'supervisor y administrador reciben evaluaciones.registrar';
end $$;

-- ---------------------------------------------------------------------------
-- Registro por el supervisor (quiosco) — atómico e idempotente
-- ---------------------------------------------------------------------------
create temp table _v as
  select pv.id as version_id, p.codigo from pruebas p join pruebas_versiones pv on pv.id = p.version_actual_id;
grant select on _v to app_user;

begin;
set local role app_user;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000001';
do $$
declare
  v_r jsonb;
  v_ver_reac uuid := (select version_id from _v where codigo = 'reaccion_simple');
  v_ver_mem uuid := (select version_id from _v where codigo = 'memoria_secuencias');
  p jsonb;
begin
  p := jsonb_build_object(
    'evaluacion_id', 'e3000000-0000-0000-0000-000000000001',
    'empresa_id', 'c3000000-0000-0000-0000-00000000000a',
    'operador_id', 'b3000000-0000-0000-0000-000000000002',
    'turno', 'diurno', 'fecha', '2026-10-15T13:00:00Z', 'dispositivo_id', 'kiosco-1',
    'ico_valor', 72.5, 'ico_nivel', 'aceptable',
    'resultados', jsonb_build_array(
      jsonb_build_object('prueba_version_id', v_ver_reac, 'tiempo_total_ms', 280, 'errores_totales', 1, 'puntaje_normalizado', 73.3, 'metricas', '{"ensayos":10}'::jsonb),
      jsonb_build_object('prueba_version_id', v_ver_mem, 'tiempo_total_ms', 40000, 'errores_totales', 2, 'puntaje_normalizado', 66.67, 'metricas', '{"nivel_max":4}'::jsonb)));
  v_r := registrar_evaluacion(p);
  assert (v_r->>'duplicada')::boolean = false, 'primer envío: no duplicada';
  assert (select count(*) from evaluaciones where id = 'e3000000-0000-0000-0000-000000000001') = 1, 'evaluación creada';
  assert (select count(*) from resultados_pruebas where evaluacion_id = 'e3000000-0000-0000-0000-000000000001') = 2, 'dos resultados creados';
  assert (select bool_and(es_valido_para_analisis and intento_numero = 1) from resultados_pruebas where evaluacion_id = 'e3000000-0000-0000-0000-000000000001'), 'primer intento: válido';
  assert (select metricas->>'nivel_max' from resultados_pruebas where prueba_version_id = v_ver_mem) = '4', 'metricas conserva nivel_max (bug p3_nivel_max del legado)';

  -- Reenvío idéntico (cola offline): no duplica
  v_r := registrar_evaluacion(p);
  assert (v_r->>'duplicada')::boolean = true, 'reenvío: duplicada';
  assert (select count(*) from resultados_pruebas where evaluacion_id = 'e3000000-0000-0000-0000-000000000001') = 2, 'el reenvío no duplica resultados';

  -- Segunda evaluación el mismo día y turno: se conserva pero NO es válida para análisis
  v_r := registrar_evaluacion(jsonb_set(jsonb_set(p, '{evaluacion_id}', '"e3000000-0000-0000-0000-000000000002"'), '{fecha}', '"2026-10-15T15:00:00Z"'));
  assert (v_r->>'duplicada')::boolean = false, 'segunda evaluación distinta se guarda';
  assert (select bool_and(not es_valido_para_analisis and intento_numero = 2) from resultados_pruebas where evaluacion_id = 'e3000000-0000-0000-0000-000000000002'), 'segundo intento del día: se conserva marcado como NO válido';

  -- Otro turno el mismo día: primer intento de ese turno
  v_r := registrar_evaluacion(jsonb_set(jsonb_set(p, '{evaluacion_id}', '"e3000000-0000-0000-0000-000000000003"'), '{turno}', '"nocturno"'));
  assert (select bool_and(es_valido_para_analisis and intento_numero = 1) from resultados_pruebas where evaluacion_id = 'e3000000-0000-0000-0000-000000000003'), 'otro turno: intento 1 válido';
end $$;
commit;

-- Validaciones del RPC
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000001';
do $$
declare
  v_ver uuid := (select version_id from _v where codigo = 'reaccion_simple');
  v_n int := 0;
  base jsonb := jsonb_build_object('evaluacion_id', 'e3000000-0000-0000-0000-0000000000f1', 'empresa_id', 'c3000000-0000-0000-0000-00000000000a',
    'operador_id', 'b3000000-0000-0000-0000-000000000002', 'turno', 'diurno');
begin
  begin perform registrar_evaluacion(base || '{"resultados":[]}'); exception when invalid_parameter_value then v_n := v_n + 1; end;
  begin perform registrar_evaluacion(base - 'turno' || '{"resultados":[{"x":1}]}'); exception when invalid_parameter_value then v_n := v_n + 1; end;
  begin perform registrar_evaluacion(base || jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('prueba_version_id','00000000-0000-4000-8000-000000000000','puntaje_normalizado',50)))); exception when foreign_key_violation then v_n := v_n + 1; end;
  begin perform registrar_evaluacion(base || jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('prueba_version_id', v_ver,'puntaje_normalizado',150)))); exception when check_violation then v_n := v_n + 1; end;
  -- Operador de OTRA empresa: la FK compuesta lo impide
  begin perform registrar_evaluacion(jsonb_set(base, '{operador_id}', '"b3000000-0000-0000-0000-000000000003"') || jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('prueba_version_id', v_ver,'puntaje_normalizado',50)))); exception when foreign_key_violation then v_n := v_n + 1; end;
  assert v_n = 5, format('5 validaciones del RPC deben rechazar (rechazó %s)', v_n);
  -- tras los fallos nada quedó a medias (cada llamada es su propia transacción implícita)
  assert (select count(*) from evaluaciones where id = 'e3000000-0000-0000-0000-0000000000f1') = 0, 'una evaluación rechazada no deja residuos';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Admin de B: ni ve ni puede registrar en A; tampoco reutilizar un id de A
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000003';
do $$
declare v_bloqueado boolean := false; v_ver uuid := (select version_id from _v where codigo = 'reaccion_simple');
begin
  assert (select count(*) from evaluaciones) = 0, 'adminB: no ve evaluaciones de A';
  assert (select count(*) from resultados_pruebas) = 0, 'adminB: no ve resultados de A';
  begin
    perform registrar_evaluacion(jsonb_build_object('evaluacion_id', 'e3000000-0000-0000-0000-000000000001', 'empresa_id', 'c3000000-0000-0000-0000-00000000000b',
      'operador_id', 'b3000000-0000-0000-0000-000000000003', 'turno', 'diurno',
      'resultados', jsonb_build_array(jsonb_build_object('prueba_version_id', v_ver, 'puntaje_normalizado', 50))));
  exception when insufficient_privilege then v_bloqueado := true; end;
  assert v_bloqueado, 'adminB: reutilizar el id de una evaluación de A es rechazado';
  v_bloqueado := false;
  begin
    perform registrar_evaluacion(jsonb_build_object('evaluacion_id', 'e3000000-0000-0000-0000-0000000000f2', 'empresa_id', 'c3000000-0000-0000-0000-00000000000a',
      'operador_id', 'b3000000-0000-0000-0000-000000000002', 'turno', 'diurno',
      'resultados', jsonb_build_array(jsonb_build_object('prueba_version_id', v_ver, 'puntaje_normalizado', 50))));
  exception when insufficient_privilege then v_bloqueado := true; end;
  assert v_bloqueado, 'adminB: registrar en la empresa A es bloqueado por RLS';
  assert (select count(*) from pruebas) = 4, 'adminB: lee el catálogo global de pruebas';
end $$;
rollback;

-- Operador con cuenta: solo ve SUS evaluaciones (Ana no tiene ninguna; Luis es kiosco)
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000002';
do $$
declare v_bloqueado boolean := false; v_ver uuid := (select version_id from _v where codigo = 'reaccion_simple');
begin
  assert (select count(*) from evaluaciones) = 0, 'operador: no ve evaluaciones de otros operadores';
  -- Registra la suya
  perform registrar_evaluacion(jsonb_build_object('evaluacion_id', 'e3000000-0000-0000-0000-0000000000a1', 'empresa_id', 'c3000000-0000-0000-0000-00000000000a',
    'operador_id', 'b3000000-0000-0000-0000-000000000001', 'turno', 'diurno', 'fecha', '2026-10-15T13:00:00Z',
    'resultados', jsonb_build_array(jsonb_build_object('prueba_version_id', v_ver, 'puntaje_normalizado', 80, 'tiempo_total_ms', 250, 'errores_totales', 0))));
  assert (select count(*) from evaluaciones) = 1, 'operador: ve su propia evaluación';
  assert (select count(*) from resultados_pruebas) = 1, 'operador: ve sus propios resultados';
  -- no puede alterar resultados ni descartar
  update evaluaciones set estado = 'descartada';
  assert (select estado from evaluaciones) = 'completa', 'operador: sin registros.eliminar no puede descartar';
  begin
    update resultados_pruebas set puntaje_normalizado = 100;
  exception when check_violation then v_bloqueado := true; end;
  assert v_bloqueado or (select puntaje_normalizado from resultados_pruebas) = 80, 'operador: no puede modificar puntajes';
  begin delete from evaluaciones; exception when others then null; end;
  assert (select count(*) from evaluaciones) = 1, 'operador: no puede borrar evaluaciones';
end $$;
rollback;

-- PGR: lee (evaluaciones.ver) pero no registra
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000004';
do $$
declare v_bloqueado boolean := false; v_ver uuid := (select version_id from _v where codigo = 'reaccion_simple');
begin
  assert (select count(*) from evaluaciones) = 3, 'PGR: ve las 3 evaluaciones de su empresa';
  begin
    perform registrar_evaluacion(jsonb_build_object('evaluacion_id', 'e3000000-0000-0000-0000-0000000000f3', 'empresa_id', 'c3000000-0000-0000-0000-00000000000a',
      'operador_id', 'b3000000-0000-0000-0000-000000000002', 'turno', 'diurno',
      'resultados', jsonb_build_array(jsonb_build_object('prueba_version_id', v_ver, 'puntaje_normalizado', 50))));
  exception when insufficient_privilege then v_bloqueado := true; end;
  assert v_bloqueado, 'PGR: no puede registrar evaluaciones';
end $$;
rollback;

-- Inmutabilidad (como dueño)
do $$
declare v_n int := 0;
begin
  begin update resultados_pruebas set puntaje_normalizado = 1 where evaluacion_id = 'e3000000-0000-0000-0000-000000000001'; exception when check_violation then v_n := v_n + 1; end;
  begin update evaluaciones set ico_valor = 1 where id = 'e3000000-0000-0000-0000-000000000001'; exception when check_violation then v_n := v_n + 1; end;
  begin update pruebas_versiones set parametros = '{}' where id = (select version_id from _v limit 1); exception when check_violation then v_n := v_n + 1; end;
  assert v_n = 3, 'resultados, evaluaciones y versiones de prueba son inmutables';
  update resultados_pruebas set es_valido_para_analisis = false where evaluacion_id = 'e3000000-0000-0000-0000-000000000001';
  update evaluaciones set estado = 'descartada' where id = 'e3000000-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- Limpieza
-- ---------------------------------------------------------------------------
delete from resultados_pruebas where empresa_id in ('c3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000b');
delete from evaluaciones where empresa_id in ('c3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000b');
delete from operadores where empresa_id in ('c3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000b');
delete from usuarios_roles where empresa_id in ('c3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000b');
delete from usuarios where email like 'tst-%@test';
delete from empresas where nit in ('TST-A', 'TST-B');
delete from auth.users where email like 'tst-%@test';

\echo 'TESTING: TODAS LAS ASERCIONES PASARON'
