-- =============================================================================
-- supabase/tests/research.test.sql
-- Módulo 10 — Research: consentimientos (historial), cohortes con consentimiento,
-- revocación, k-anonimato, exportación anonimizada con rastro, RLS multiempresa.
-- Precondición: migraciones 0001–0018.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-000000000001', 'rs-inv@test'),
  ('a7000000-0000-0000-0000-000000000002', 'rs-adm@test'),
  ('a7000000-0000-0000-0000-000000000003', 'rs-invb@test');
insert into empresas (id, nombre, nit) values
  ('c7000000-0000-0000-0000-00000000000a', 'Rs A', 'RS-A'),
  ('c7000000-0000-0000-0000-00000000000b', 'Rs B', 'RS-B');
insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-00000000000a', 'Inv A', 'rs-inv@test'),
  ('a7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-00000000000a', 'Adm A', 'rs-adm@test'),
  ('a7000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-00000000000b', 'Inv B', 'rs-invb@test');

-- Rol de investigación (acceso + exporte) para las empresas A y B
insert into roles (id, empresa_id, nombre, es_plantilla) values
  ('d7000000-0000-0000-0000-00000000000a', 'c7000000-0000-0000-0000-00000000000a', 'Investigador', false),
  ('d7000000-0000-0000-0000-00000000000b', 'c7000000-0000-0000-0000-00000000000b', 'Investigador', false);
insert into roles_permisos (role_id, permiso_id)
select r.id, p.id from roles r cross join permisos p
 where r.id in ('d7000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-00000000000b') and p.codigo in ('investigacion.acceder', 'datos.exportar');
insert into usuarios_roles (usuario_id, role_id, empresa_id) values
  ('a7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000a', 'c7000000-0000-0000-0000-00000000000a'),
  ('a7000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-00000000000b', 'c7000000-0000-0000-0000-00000000000b');
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a7000000-0000-0000-0000-000000000002', id, 'c7000000-0000-0000-0000-00000000000a' from roles where nombre = 'Administrador de empresa' and es_plantilla;

insert into areas (id, empresa_id, nombre) values ('e7000000-0000-0000-0000-00000000000a', 'c7000000-0000-0000-0000-00000000000a', 'Mantenimiento');
-- 6 operadores en A (los 5 primeros en el área) y 1 en B
insert into operadores (id, empresa_id, cedula, nombre, apellido, area_id)
select ('b7000000-0000-0000-0000-00000000000' || g)::uuid, 'c7000000-0000-0000-0000-00000000000a', '77000000' || g, 'Nombre' || g, 'Apellido' || g,
       case when g <= 5 then 'e7000000-0000-0000-0000-00000000000a'::uuid end
  from generate_series(1, 6) g;
insert into operadores (id, empresa_id, cedula, nombre, apellido) values
  ('b7000000-0000-0000-0000-0000000000b1', 'c7000000-0000-0000-0000-00000000000b', '77000000B1', 'Eva', 'OtraEmpresa');

-- Una evaluación completa por operador de A (con su resultado)
create temp table _v as select pv.id as version_id from pruebas p join pruebas_versiones pv on pv.id = p.version_actual_id where p.codigo = 'reaccion_simple';
insert into evaluaciones (id, empresa_id, operador_id, turno, fecha, ico_valor, ico_nivel)
select ('f7000000-0000-0000-0000-00000000000' || g)::uuid, 'c7000000-0000-0000-0000-00000000000a', ('b7000000-0000-0000-0000-00000000000' || g)::uuid, 'Diurno', now(), 60 + g, 'aceptable'
  from generate_series(1, 6) g;
insert into resultados_pruebas (evaluacion_id, empresa_id, operador_id, prueba_version_id, intento_numero, clave_idempotencia, tiempo_total_ms, errores_totales, puntaje_normalizado)
select ('f7000000-0000-0000-0000-00000000000' || g)::uuid, 'c7000000-0000-0000-0000-00000000000a', ('b7000000-0000-0000-0000-00000000000' || g)::uuid, (select version_id from _v), 1, 'rs-' || g, 300 + g, g, 70 + g
  from generate_series(1, 6) g;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant select on _v to app_user;

-- ---------------------------------------------------------------------------
-- Consentimientos: quién puede registrarlos, historial inmutable, vigente = último
-- ---------------------------------------------------------------------------
do $$
declare
  v_a constant uuid := 'c7000000-0000-0000-0000-00000000000a';
  v_adm constant uuid := 'a7000000-0000-0000-0000-000000000002';
  v_inv constant uuid := 'a7000000-0000-0000-0000-000000000001';
  v_ok boolean;
  v_n int;
begin
  -- El investigador NO registra consentimientos (no tiene operadores.administrar)
  perform set_config('request.jwt.claim.sub', v_inv::text, true);
  set local role app_user;
  begin
    insert into consentimientos (empresa_id, operador_id, proposito, otorgado) values (v_a, 'b7000000-0000-0000-0000-000000000001', 'investigacion_cientifica', true);
    v_ok := true;
  exception when insufficient_privilege then v_ok := false; end;
  assert v_ok = false, 'el investigador no puede registrar consentimientos';
  reset role;

  -- El administrador sí: 5 operadores consienten investigación, el 6.º solo evaluación SST
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  set local role app_user;
  insert into consentimientos (empresa_id, operador_id, proposito, otorgado)
  select v_a, ('b7000000-0000-0000-0000-00000000000' || g)::uuid, 'investigacion_cientifica', true from generate_series(1, 5) g;
  insert into consentimientos (empresa_id, operador_id, proposito, otorgado) values (v_a, 'b7000000-0000-0000-0000-000000000006', 'evaluacion_sst', true);
  begin
    insert into consentimientos (empresa_id, operador_id, proposito, otorgado) values (v_a, 'b7000000-0000-0000-0000-000000000001', 'otro_proposito', true);
    v_ok := true;
  exception when check_violation then v_ok := false; end;
  assert v_ok = false, 'propósito desconocido rechazado';
  -- Inmutable: sin políticas de UPDATE/DELETE la app no altera nada (0 filas)...
  update consentimientos set otorgado = false where operador_id = 'b7000000-0000-0000-0000-000000000001';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'UPDATE de consentimiento no afecta filas (RLS)';
  delete from consentimientos where operador_id = 'b7000000-0000-0000-0000-000000000001';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'DELETE de consentimiento no afecta filas (RLS)';
  reset role;
  -- ...y ni siquiera el dueño de la tabla puede (trigger)
  begin update consentimientos set otorgado = false where operador_id = 'b7000000-0000-0000-0000-000000000001'; v_ok := true;
  exception when insufficient_privilege then v_ok := false; end;
  assert v_ok = false, 'UPDATE bloqueado por trigger incluso para el dueño';
  begin delete from consentimientos where operador_id = 'b7000000-0000-0000-0000-000000000001'; v_ok := true;
  exception when insufficient_privilege then v_ok := false; end;
  assert v_ok = false, 'DELETE directo bloqueado por trigger incluso para el dueño';

  assert consentimiento_vigente('b7000000-0000-0000-0000-000000000001', 'investigacion_cientifica'), 'vigente: otorgado';
  assert not consentimiento_vigente('b7000000-0000-0000-0000-000000000006', 'investigacion_cientifica'), 'consentir SST NO implica consentir investigación';
  assert not consentimiento_vigente('b7000000-0000-0000-0000-000000000003', 'evaluacion_sst'), 'sin registro = no otorgado';
end $$;

-- ---------------------------------------------------------------------------
-- Cohortes: solo con consentimiento; poblar por criterio; revocar saca de la cohorte
-- ---------------------------------------------------------------------------
do $$
declare
  v_a constant uuid := 'c7000000-0000-0000-0000-00000000000a';
  v_inv constant uuid := 'a7000000-0000-0000-0000-000000000001';
  v_adm constant uuid := 'a7000000-0000-0000-0000-000000000002';
  v_c uuid;
  v_n int;
  v_ok boolean;
begin
  perform set_config('request.jwt.claim.sub', v_inv::text, true);
  set local role app_user;
  insert into cohortes (empresa_id, nombre, criterio) values (v_a, 'Mantenimiento', '{"area_id":"e7000000-0000-0000-0000-00000000000a"}') returning id into v_c;
  begin insert into cohortes (empresa_id, nombre) values (v_a, '  mantenimiento '); v_ok := true;
  exception when unique_violation then v_ok := false; end;
  assert v_ok = false, 'nombre de cohorte único por empresa (sin distinguir mayúsculas)';

  -- El operador 6 no consintió investigación: no puede entrar
  begin insert into cohortes_operadores (cohorte_id, empresa_id, operador_id) values (v_c, v_a, 'b7000000-0000-0000-0000-000000000006'); v_ok := true;
  exception when check_violation then v_ok := false; end;
  assert v_ok = false, 'sin consentimiento de investigación no se entra a una cohorte';

  v_n := poblar_cohorte(v_c);
  assert v_n = 5, 'poblar_cohorte incorpora a los 5 operadores del área con consentimiento: ' || v_n;
  assert poblar_cohorte(v_c) = 0, 'poblar es idempotente';
  reset role;

  -- Revocar (como admin): sale de la cohorte; el historial conserva ambas filas
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  set local role app_user;
  insert into consentimientos (empresa_id, operador_id, proposito, otorgado) values (v_a, 'b7000000-0000-0000-0000-000000000005', 'investigacion_cientifica', false);
  reset role;
  assert not consentimiento_vigente('b7000000-0000-0000-0000-000000000005', 'investigacion_cientifica'), 'revocado';
  assert (select count(*) from cohortes_operadores where cohorte_id = v_c) = 4, 'la revocación saca al operador de la cohorte';
  assert (select count(*) from consentimientos where operador_id = 'b7000000-0000-0000-0000-000000000005') = 2, 'el historial conserva otorgamiento y revocación';

  -- Volver a consentir permite reingresar
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  set local role app_user;
  insert into consentimientos (empresa_id, operador_id, proposito, otorgado) values (v_a, 'b7000000-0000-0000-0000-000000000005', 'investigacion_cientifica', true);
  reset role;
  perform set_config('request.jwt.claim.sub', v_inv::text, true);
  set local role app_user;
  assert poblar_cohorte(v_c) = 1, 'el operador que vuelve a consentir reingresa';
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Exportación: permisos, mínimo de participantes, anonimato, rastro
-- ---------------------------------------------------------------------------
do $$
declare
  v_a constant uuid := 'c7000000-0000-0000-0000-00000000000a';
  v_b constant uuid := 'c7000000-0000-0000-0000-00000000000b';
  v_inv constant uuid := 'a7000000-0000-0000-0000-000000000001';
  v_adm constant uuid := 'a7000000-0000-0000-0000-000000000002';
  v_invb constant uuid := 'a7000000-0000-0000-0000-000000000003';
  v_c uuid := (select id from cohortes where empresa_id = v_a and nombre = 'Mantenimiento');
  v_pequena uuid;
  v_r1 jsonb; v_r2 jsonb;
  v_txt text;
  v_ok boolean;
begin
  -- Administrador de empresa NO exporta (no tiene datos.exportar ni investigacion.acceder)
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  set local role app_user;
  begin perform exportar_dataset(v_a, v_c); v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  assert v_ok = false, 'sin permisos no se exporta';
  reset role;

  -- Investigador de B no exporta cohortes de A
  perform set_config('request.jwt.claim.sub', v_invb::text, true);
  set local role app_user;
  begin perform exportar_dataset(v_a, v_c); v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  assert v_ok = false, 'no se exporta con una empresa ajena';
  begin perform exportar_dataset(v_b, v_c); v_ok := true; exception when no_data_found then v_ok := false; end;
  assert v_ok = false, 'la cohorte de otra empresa no existe para B';
  assert (select count(*) from cohortes) = 0, 'RLS: B no ve cohortes de A';
  assert (select count(*) from consentimientos) = 0, 'RLS: B no ve consentimientos de A';
  reset role;

  -- Cohorte pequeña (< 5): rechazada
  perform set_config('request.jwt.claim.sub', v_inv::text, true);
  set local role app_user;
  insert into cohortes (empresa_id, nombre) values (v_a, 'Pequeña') returning id into v_pequena;
  insert into cohortes_operadores (cohorte_id, empresa_id, operador_id) values (v_pequena, v_a, 'b7000000-0000-0000-0000-000000000001');
  begin perform exportar_dataset(v_a, v_pequena); v_ok := true; exception when check_violation then v_ok := false; end;
  assert v_ok = false, 'cohorte con menos de 5 participantes no se exporta';

  -- Exportación válida (dos veces: los pseudónimos NO deben coincidir entre exportes)
  v_r1 := exportar_dataset(v_a, v_c);
  v_r2 := exportar_dataset(v_a, v_c, current_date - 1, current_date + 1);
  reset role;

  assert (v_r1->>'participantes')::int = 5 and jsonb_array_length(v_r1->'filas') = 5, 'una fila por resultado de los 5 participantes';
  v_txt := (v_r1->'filas')::text;
  assert v_txt !~ '77000000' and v_txt !~ 'Nombre' and v_txt !~ 'Apellido' and v_txt !~ 'Mantenimiento', 'el dataset no contiene cédula, nombre, apellido ni área';
  assert v_txt !~ 'b7000000-0000', 'el dataset no contiene ids reales de operadores';
  assert (select count(distinct f->>'participante') from jsonb_array_elements(v_r1->'filas') f) = 5, 'pseudónimo estable dentro del dataset';
  assert not exists (select 1 from jsonb_array_elements(v_r1->'filas') a join jsonb_array_elements(v_r2->'filas') b on a->>'participante' = b->>'participante'),
    'los pseudónimos no se pueden enlazar entre exportes';
  assert (v_r1->'filas'->0) ? 'puntaje_normalizado' and (v_r1->'filas'->0) ? 'ico_valor', 'incluye las variables de análisis';

  -- Rastro: dataset registrado y auditoría en la misma operación
  assert (select count(*) from datasets_exportados where empresa_id = v_a and anonimizado) = 2, 'cada exporte queda registrado';
  assert (select count(*) from auditoria where empresa_id = v_a and accion = 'dataset.exportar') = 2, 'cada exporte queda auditado';
  assert not exists (select 1 from auditoria where accion = 'dataset.exportar' and empresa_id = v_a and detalle_nuevo::text ~ 'Nombre|77000000'), 'la auditoría del exporte no contiene identidad';
  assert (select usuario_id from auditoria where accion = 'dataset.exportar' and empresa_id = v_a limit 1) = v_inv, 'auditoría con el usuario que exportó';

  -- Los exportes no se alteran ni borran desde la app
  perform set_config('request.jwt.claim.sub', v_inv::text, true);
  set local role app_user;
  update datasets_exportados set filas = 0;
  get diagnostics v_ok = row_count;
  reset role;
  assert (select count(*) from datasets_exportados where filas = 0) = 0, 'sin política de UPDATE: ningún exporte se altera';

  -- Una revocación posterior excluye al operador de futuros exportes
  insert into consentimientos (empresa_id, operador_id, proposito, otorgado) values (v_a, 'b7000000-0000-0000-0000-000000000001', 'investigacion_cientifica', false);
  perform set_config('request.jwt.claim.sub', v_inv::text, true);
  set local role app_user;
  begin perform exportar_dataset(v_a, v_c); v_ok := true; exception when check_violation then v_ok := false; end;
  reset role;
  assert v_ok = false, 'tras revocar quedan 4 participantes: por debajo del mínimo, ya no se exporta';
end $$;

do $$ begin raise notice 'RESEARCH: TODAS LAS ASERCIONES PASARON'; end $$;
