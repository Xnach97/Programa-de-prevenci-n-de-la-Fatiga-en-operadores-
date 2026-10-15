-- =============================================================================
-- supabase/tests/rules.test.sql
-- Módulo 7 — Rules Engine: paridad del validador de condiciones con
-- spec/fixtures/condiciones.json (el mismo que usa statistics/rules.js),
-- CHECKs, publicar_resultado_reglas, estados de alertas, RLS y anonimización.
-- Precondición: migraciones 0001–0016.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000001', 'rg-sup@test'),
  ('a5000000-0000-0000-0000-000000000002', 'rg-op@test'),
  ('a5000000-0000-0000-0000-000000000003', 'rg-adminb@test'),
  ('a5000000-0000-0000-0000-000000000004', 'rg-adm@test');
insert into empresas (id, nombre, nit) values
  ('c5000000-0000-0000-0000-00000000000a', 'Rg A', 'RG-A'),
  ('c5000000-0000-0000-0000-00000000000b', 'Rg B', 'RG-B');
insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-00000000000a', 'Sup', 'rg-sup@test'),
  ('a5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-00000000000a', 'Op', 'rg-op@test'),
  ('a5000000-0000-0000-0000-000000000003', 'c5000000-0000-0000-0000-00000000000b', 'Admin B', 'rg-adminb@test'),
  ('a5000000-0000-0000-0000-000000000004', 'c5000000-0000-0000-0000-00000000000a', 'Admin A', 'rg-adm@test');
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a5000000-0000-0000-0000-000000000001', id, 'c5000000-0000-0000-0000-00000000000a' from roles where nombre = 'Supervisor SST' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a5000000-0000-0000-0000-000000000002', id, 'c5000000-0000-0000-0000-00000000000a' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a5000000-0000-0000-0000-000000000003', id, 'c5000000-0000-0000-0000-00000000000b' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a5000000-0000-0000-0000-000000000004', id, 'c5000000-0000-0000-0000-00000000000a' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into operadores (id, empresa_id, cedula, nombre, apellido) values
  ('b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-00000000000a', '2200000001', 'Ana', 'Regla'),
  ('b5000000-0000-0000-0000-000000000003', 'c5000000-0000-0000-0000-00000000000b', '2200000003', 'Eva', 'Otra');
insert into evaluaciones (id, empresa_id, operador_id, turno, fecha) values
  ('e5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'Diurno', now()),
  ('e5000000-0000-0000-0000-000000000003', 'c5000000-0000-0000-0000-00000000000b', 'b5000000-0000-0000-0000-000000000003', 'Diurno', now());

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;

do $$
declare
  v_a constant uuid := 'c5000000-0000-0000-0000-00000000000a';
  v_b constant uuid := 'c5000000-0000-0000-0000-00000000000b';
  v_op constant uuid := 'b5000000-0000-0000-0000-000000000001';
  v_op_b constant uuid := 'b5000000-0000-0000-0000-000000000003';
  v_ev constant uuid := 'e5000000-0000-0000-0000-000000000001';
  v_ev_b constant uuid := 'e5000000-0000-0000-0000-000000000003';
  v_regla uuid; v_regla_inactiva uuid; v_plantilla uuid; v_alerta uuid;
  v_c jsonb; v_r jsonb; v_n int;
begin
  -- Paridad con statistics/rules.js
  foreach v_c in array array[
    '{"indicador": "ico", "op": "<", "valor": 50}'::jsonb,
    '{"indicador": "reaccion_simple.tiempo", "op": ">", "percentil": 90}'::jsonb,
    '{"and": [{"indicador": "ico", "op": ">=", "valor": 50}, {"indicador": "ico", "op": "<", "valor": 70}]}'::jsonb,
    '{"or": [{"indicador": "indice_fatiga", "op": ">=", "valor": 60}, {"not": {"indicador": "ico", "op": ">", "valor": 80}}]}'::jsonb,
    '{"and": [{"or": [{"indicador": "ico", "op": "==", "valor": 1}, {"indicador": "ico", "op": "!=", "valor": 2}]}]}'::jsonb
  ] loop
    assert validar_condicion_regla(v_c) and contar_hojas_condicion(v_c) <= 20, 'debe ser válida: ' || v_c::text;
  end loop;
  foreach v_c in array array[
    '[]'::jsonb,
    '"ico < 50"'::jsonb,
    '5'::jsonb,
    '{}'::jsonb,
    '{"indicador": "ico", "op": "<"}'::jsonb,
    '{"indicador": "ico", "op": "<", "valor": "50"}'::jsonb,
    '{"indicador": "ico", "op": "<", "valor": 50, "extra": 1}'::jsonb,
    '{"indicador": "ico", "op": "~", "valor": 50}'::jsonb,
    '{"indicador": "ICO", "op": "<", "valor": 50}'::jsonb,
    '{"indicador": "ico; drop table x", "op": "<", "valor": 50}'::jsonb,
    '{"indicador": "ico", "op": "<", "percentil": 101}'::jsonb,
    '{"indicador": "ico", "op": "<", "percentil": -1}'::jsonb,
    '{"indicador": "ico", "op": "<", "valor": 1, "percentil": 2}'::jsonb,
    '{"and": []}'::jsonb,
    '{"and": {"indicador": "ico", "op": "<", "valor": 1}}'::jsonb,
    '{"and": [{"indicador": "ico", "op": "<", "valor": 1}], "or": []}'::jsonb,
    '{"not": [{"indicador": "ico", "op": "<", "valor": 1}]}'::jsonb,
    '{"not": {"indicador": "ico", "op": "<", "valor": 1}, "and": []}'::jsonb,
    '{"and": [{"and": [{"and": [{"and": [{"and": [{"and": [{"indicador": "ico", "op": "<", "valor": 1}]}]}]}]}]}]}'::jsonb
  ] loop
    assert not coalesce(validar_condicion_regla(v_c), false), 'debe ser inválida: ' || v_c::text;
  end loop;
  assert not coalesce(validar_condicion_regla(null), false), 'null inválida';

  -- Semilla global
  select count(*) into v_n from reglas where empresa_id is null;
  assert v_n = 4, 'reglas globales: ' || v_n;
  select count(*) into v_n from recomendaciones_plantillas where empresa_id is null;
  assert v_n = 3, 'plantillas globales: ' || v_n;
  assert exists (select 1 from permisos where codigo = 'alertas.gestionar'), 'permiso alertas.gestionar';

  -- CHECK de la tabla rechaza condiciones inválidas y más de 20 hojas
  begin
    insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla) values (v_a, 'mala', '{"indicador":"ico","op":"~","valor":1}', 'roja', 'x');
    assert false, 'condición inválida debió fallar';
  exception when check_violation then null; end;
  begin
    insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla)
    values (v_a, 'mucha', '{"and":[{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]},{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]},{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]},{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]},{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]},{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]},{"or":[{"indicador":"ico","op":"<","valor":1},{"indicador":"ico","op":"<","valor":2},{"indicador":"ico","op":"<","valor":3}]}]}', 'roja', 'x');
    assert false, 'más de 20 hojas debió fallar';
  exception when check_violation then null; end;
  begin
    insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla) values (v_a, 'sev', '{"indicador":"ico","op":"<","valor":1}', 'morada', 'x');
    assert false, 'severidad inválida debió fallar';
  exception when check_violation then null; end;

  insert into reglas (id, empresa_id, nombre, condicion, severidad, mensaje_plantilla)
  values ('f5000000-0000-0000-0000-00000000000a', v_a, 'Regla A', '{"indicador":"ico","op":"<","valor":50}', 'roja', 'ICO de {operador} bajo');
  v_regla := 'f5000000-0000-0000-0000-00000000000a';
  insert into reglas (id, empresa_id, nombre, condicion, severidad, mensaje_plantilla, estado)
  values ('f5000000-0000-0000-0000-00000000000c', v_a, 'Regla inactiva', '{"indicador":"ico","op":"<","valor":50}', 'info', 'x', 'inactiva');
  v_regla_inactiva := 'f5000000-0000-0000-0000-00000000000c';
  insert into reglas (id, empresa_id, nombre, condicion, severidad, mensaje_plantilla)
  values ('f5000000-0000-0000-0000-00000000000b', v_b, 'Regla B', '{"indicador":"ico","op":"<","valor":50}', 'roja', 'x');
  select id into v_plantilla from recomendaciones_plantillas where empresa_id is null and codigo = 'pausa_activa';

  -- Supervisor (registrar + ver + gestionar)
  perform set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000001', true);
  set local role app_user;

  select count(*) into v_n from reglas;
  assert v_n = 6, 'supervisor ve 4 globales + 2 de A (ve ' || v_n || '), no la de B';

  v_r := publicar_resultado_reglas(v_a,
    jsonb_build_array(jsonb_build_object('regla_id', v_regla, 'operador_id', v_op, 'evaluacion_id', v_ev, 'severidad', 'info', 'mensaje', 'ICO de Ana Regla bajo')),
    jsonb_build_array(jsonb_build_object('evaluacion_id', v_ev, 'plantilla_id', v_plantilla, 'texto', 'Pausa para Ana Regla')));
  assert (v_r->>'alertas')::int = 1 and (v_r->>'recomendaciones')::int = 1, 'publicó 1+1: ' || v_r::text;
  select id into v_alerta from alertas where regla_id = v_regla limit 1;
  assert (select severidad from alertas where id = v_alerta) = 'roja', 'la severidad la fija la regla, no el cliente';

  -- Idempotencia
  v_r := publicar_resultado_reglas(v_a,
    jsonb_build_array(jsonb_build_object('regla_id', v_regla, 'operador_id', v_op, 'evaluacion_id', v_ev, 'mensaje', 'otra vez')),
    jsonb_build_array(jsonb_build_object('evaluacion_id', v_ev, 'plantilla_id', v_plantilla, 'texto', 'otra vez')));
  assert (v_r->>'alertas')::int = 0 and (v_r->>'recomendaciones')::int = 0, 'reenvío no duplica';

  -- Regla inactiva / de otra empresa / evaluación ajena / operador que no corresponde / plantilla inexistente
  begin
    perform publicar_resultado_reglas(v_a, jsonb_build_array(jsonb_build_object('regla_id', v_regla_inactiva, 'operador_id', v_op, 'evaluacion_id', v_ev, 'mensaje', 'x')), '[]');
    assert false, 'regla inactiva debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_resultado_reglas(v_a, jsonb_build_array(jsonb_build_object('regla_id', 'f5000000-0000-0000-0000-00000000000b', 'operador_id', v_op, 'evaluacion_id', v_ev, 'mensaje', 'x')), '[]');
    assert false, 'regla de otra empresa debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_resultado_reglas(v_a, jsonb_build_array(jsonb_build_object('regla_id', v_regla, 'operador_id', v_op_b, 'evaluacion_id', v_ev_b, 'mensaje', 'x')), '[]');
    assert false, 'evaluación ajena debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_resultado_reglas(v_a, jsonb_build_array(jsonb_build_object('regla_id', v_regla, 'operador_id', v_op_b, 'evaluacion_id', v_ev, 'mensaje', 'x')), '[]');
    assert false, 'operador que no corresponde a la evaluación debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_resultado_reglas(v_a, '[]', jsonb_build_array(jsonb_build_object('evaluacion_id', v_ev, 'plantilla_id', gen_random_uuid(), 'texto', 'x')));
    assert false, 'plantilla inexistente debió fallar';
  exception when foreign_key_violation then null; end;
  begin
    perform publicar_resultado_reglas(v_a, '{"a":1}', '[]');
    assert false, 'entrada no arreglo debió fallar';
  exception when invalid_parameter_value then null; end;

  -- Escritura directa de alertas denegada
  begin
    insert into alertas (empresa_id, regla_id, operador_id, evaluacion_id, severidad, mensaje) values (v_a, v_regla, v_op, v_ev, 'roja', 'x');
    assert false, 'insert directo debió fallar';
  exception when insufficient_privilege then null; end;

  -- Atender: cambia estado y registra quién/cuándo; el resto es inmutable
  begin
    update alertas set mensaje = 'alterado' where id = v_alerta;
    assert false, 'cambiar el mensaje debió fallar';
  exception when check_violation then null; end;
  update alertas set estado = 'atendida' where id = v_alerta;
  assert (select atendida_por from alertas where id = v_alerta) = 'a5000000-0000-0000-0000-000000000001', 'atendida_por';
  assert (select atendida_en from alertas where id = v_alerta) is not null, 'atendida_en';
  begin
    update alertas set estado = 'abierta' where id = v_alerta;
    assert false, 'reabrir debió fallar';
  exception when check_violation then null; end;
  select count(*) into v_n from recomendaciones_generadas;
  assert v_n = 1, 'supervisor ve la recomendación';
  reset role;

  -- Operador: ve reglas (las necesita para evaluar) pero no alertas ni recomendaciones; no crea reglas
  perform set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000002', true);
  set local role app_user;
  select count(*) into v_n from reglas;
  assert v_n = 6, 'operador lee reglas de su empresa y globales';
  select count(*) into v_n from alertas;
  assert v_n = 0, 'operador no ve alertas';
  select count(*) into v_n from recomendaciones_generadas;
  assert v_n = 0, 'operador no ve recomendaciones';
  begin
    insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla) values (v_a, 'x', '{"indicador":"ico","op":"<","valor":1}', 'info', 'x');
    assert false, 'operador no debe crear reglas';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Admin A: crea reglas de su empresa, no globales ni de B
  perform set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000004', true);
  set local role app_user;
  insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla) values (v_a, 'Mía', '{"indicador":"ico","op":"<","valor":1}', 'info', 'x');
  begin
    insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla) values (null, 'Global falsa', '{"indicador":"ico","op":"<","valor":1}', 'info', 'x');
    assert false, 'admin no crea reglas globales';
  exception when insufficient_privilege then null; end;
  begin
    insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla) values (v_b, 'En B', '{"indicador":"ico","op":"<","valor":1}', 'info', 'x');
    assert false, 'admin no crea reglas en otra empresa';
  exception when insufficient_privilege then null; end;
  update reglas set estado = 'inactiva' where nombre = 'Mía';
  update reglas set estado = 'inactiva' where empresa_id is null;   -- 0 filas visibles para escritura: RLS las filtra
  assert (select count(*) from reglas where empresa_id is null and estado = 'inactiva') = 0, 'reglas globales intactas';
  reset role;

  -- Admin B no ve alertas de A ni puede publicar en A
  perform set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-000000000003', true);
  set local role app_user;
  select count(*) into v_n from alertas;
  assert v_n = 0, 'Admin B no ve alertas de A';
  select count(*) into v_n from reglas where nombre like 'Regla A';
  assert v_n = 0, 'Admin B no ve reglas de A';
  begin
    perform publicar_resultado_reglas(v_a, '[]', '[]');
    assert false, 'Admin B no publica en A';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Anonimización: el nombre desaparece de alertas y recomendaciones ya generadas
  assert (select mensaje from alertas where id = v_alerta) like '%Ana Regla%', 'precondición: la alerta contiene el nombre';
  update operadores set estado = 'anonimizado' where id = v_op;
  assert (select mensaje from alertas where id = v_alerta) = 'ICO de Operador anonimizado bajo', 'alerta anonimizada: ' || (select mensaje from alertas where id = v_alerta);
  assert (select texto_resuelto from recomendaciones_generadas where evaluacion_id = v_ev) = 'Pausa para Operador anonimizado', 'recomendación anonimizada';

  raise notice 'RULES: TODAS LAS ASERCIONES PASARON';
end $$;
