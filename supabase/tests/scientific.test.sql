-- =============================================================================
-- supabase/tests/scientific.test.sql
-- Pruebas con aserciones del Módulo 4 (Scientific Engine): validación de jsonb,
-- versionado inmutable, no solape de vigencias, publicación atómica, RLS.
-- Precondición: migraciones 0001–0008 aplicadas. Un fallo aborta con ERROR.
-- =============================================================================

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000001', 'sci-admin1@test'),
  ('a2000000-0000-0000-0000-000000000002', 'sci-supervisor1@test'),
  ('a2000000-0000-0000-0000-000000000003', 'sci-operador1@test'),
  ('a2000000-0000-0000-0000-000000000004', 'sci-admin2@test'),
  ('a2000000-0000-0000-0000-000000000005', 'sci-super@test');

insert into empresas (id, nombre, nit) values
  ('c2000000-0000-0000-0000-00000000000a', 'Sci Empresa A', 'SCI-A'),
  ('c2000000-0000-0000-0000-00000000000b', 'Sci Empresa B', 'SCI-B');

insert into usuarios (id, empresa_id, nombre_completo, email) values
  ('a2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-00000000000a', 'Admin A', 'sci-admin1@test'),
  ('a2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-00000000000a', 'Supervisor A', 'sci-supervisor1@test'),
  ('a2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-00000000000a', 'Operador A', 'sci-operador1@test'),
  ('a2000000-0000-0000-0000-000000000004', 'c2000000-0000-0000-0000-00000000000b', 'Admin B', 'sci-admin2@test'),
  ('a2000000-0000-0000-0000-000000000005', 'c2000000-0000-0000-0000-00000000000a', 'Super', 'sci-super@test');

insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a2000000-0000-0000-0000-000000000001', id, 'c2000000-0000-0000-0000-00000000000a' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a2000000-0000-0000-0000-000000000002', id, 'c2000000-0000-0000-0000-00000000000a' from roles where nombre = 'Supervisor SST' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a2000000-0000-0000-0000-000000000003', id, 'c2000000-0000-0000-0000-00000000000a' from roles where nombre = 'Operador' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a2000000-0000-0000-0000-000000000004', id, 'c2000000-0000-0000-0000-00000000000b' from roles where nombre = 'Administrador de empresa' and es_plantilla;
insert into usuarios_roles (usuario_id, role_id, empresa_id)
select 'a2000000-0000-0000-0000-000000000005', id, 'c2000000-0000-0000-0000-00000000000a' from roles where nombre = 'Super Administrador' and es_plantilla;

insert into areas (id, empresa_id, nombre) values ('d2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Sala de mandos');
insert into cargos (id, empresa_id, nombre, area_id) values
  ('e2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Cargo A', 'd2000000-0000-0000-0000-00000000000a'),
  ('e2000000-0000-0000-0000-00000000000b', 'c2000000-0000-0000-0000-00000000000b', 'Cargo B', null);

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

-- ---------------------------------------------------------------------------
-- Validadores
-- ---------------------------------------------------------------------------
do $$
begin
  assert validar_pesos_ico('{"a":25,"b":75}'), 'pesos válidos';
  assert validar_pesos_ico('{"a":0,"b":1}'), 'un peso en 0 es válido si la suma > 0';
  assert not validar_pesos_ico('{}'), 'pesos vacíos inválidos';
  assert not validar_pesos_ico('{"a":0}'), 'suma 0 inválida';
  assert not validar_pesos_ico('{"a":-1,"b":5}'), 'peso negativo inválido';
  assert not validar_pesos_ico('{"a":"25"}'), 'peso como texto inválido';
  assert not validar_pesos_ico('[1,2]'), 'arreglo inválido';
  assert not validar_pesos_ico(null), 'null inválido';

  assert validar_parametros_baremo('dinamico', '{"ventana_dias":180,"minimo_registros":30}'), 'dinámico válido';
  assert not validar_parametros_baremo('dinamico', '{"ventana_dias":0,"minimo_registros":30}'), 'ventana 0 inválida';
  assert not validar_parametros_baremo('dinamico', '{"ventana_dias":1.5,"minimo_registros":30}'), 'ventana fraccionaria inválida';
  assert not validar_parametros_baremo('dinamico', '{"ventana_dias":30,"minimo_registros":1}'), 'mínimo < 2 inválido';
  assert validar_parametros_baremo('institucional', '{"media":300,"desviacion":50}'), 'institucional μ/σ válido';
  assert not validar_parametros_baremo('institucional', '{"media":300,"desviacion":0}'), 'σ = 0 inválida';
  assert validar_parametros_baremo('institucional', '{"umbrales":{"excelente":200,"atencion":400}}'), 'umbrales menor_mejor válidos';
  assert not validar_parametros_baremo('institucional', '{"umbrales":{"excelente":500,"atencion":400}}'), 'umbrales incoherentes (menor_mejor)';
  assert validar_parametros_baremo('institucional', '{"direccion":"mayor_mejor","umbrales":{"excelente":80,"atencion":60}}'), 'umbrales mayor_mejor válidos';
  assert not validar_parametros_baremo('institucional', '{"direccion":"mayor_mejor","umbrales":{"excelente":60,"atencion":80}}'), 'umbrales incoherentes (mayor_mejor)';
  assert not validar_parametros_baremo('institucional', '{"media":300,"desviacion":50,"direccion":"arriba"}'), 'dirección inválida';
  assert validar_parametros_baremo('dinamico', '{"media":1}') is not null and not validar_parametros_baremo('dinamico', '{"media":1}'), 'campos ausentes: false, nunca NULL (un CHECK con NULL pasa)';
  assert not validar_parametros_baremo('otra', '{"media":1,"desviacion":1}'), 'modalidad desconocida';
end $$;

-- ---------------------------------------------------------------------------
-- Admin A: publica pesos y baremos; versionado atómico e inmutable
-- ---------------------------------------------------------------------------
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000001';
do $$
declare v_id1 uuid; v_id2 uuid;
begin
  v_id1 := publicar_ico_configuracion('c2000000-0000-0000-0000-00000000000a', null, '{"reaccion":60,"memoria":40}');
  assert (select vigente_hasta from ico_configuraciones where id = v_id1) is null, 'v1 queda vigente';
  assert (select created_by from ico_configuraciones where id = v_id1) = 'a2000000-0000-0000-0000-000000000001', 'created_by = auth.uid()';
  assert (select count(*) from ico_configuraciones) = 1, 'adminA ve su configuración';

  -- baremo institucional del ICO (prueba_id nulo)
  perform publicar_baremo('c2000000-0000-0000-0000-00000000000a', null, 'institucional',
                          '{"direccion":"mayor_mejor","umbrales":{"excelente":80,"atencion":60}}', null);
  assert (select count(*) from baremos where empresa_id is not null) = 1, 'adminA ve su baremo';
end $$;
commit;

-- Segunda versión en OTRA transacción (now() distinto): cierra la anterior
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000001';
do $$
declare v_id2 uuid;
begin
  v_id2 := publicar_ico_configuracion('c2000000-0000-0000-0000-00000000000a', null, '{"reaccion":50,"memoria":50}');
  assert (select count(*) from ico_configuraciones where vigente_hasta is null) = 1, 'solo una versión vigente';
  assert (select count(*) from ico_configuraciones) = 2, 'la versión anterior se conserva (historial)';
  assert (select pesos->>'reaccion' from ico_configuraciones where vigente_hasta is not null) = '60', 'la versión cerrada conserva sus pesos';
  assert (select vigente_hasta from ico_configuraciones where vigente_hasta is not null) = (select vigente_desde from ico_configuraciones where id = v_id2), 'sin huecos ni solapes: cierre = inicio de la nueva';
end $$;
commit;

-- Inmutabilidad
do $$
declare v_bloqueado boolean := false;
begin
  begin
    update ico_configuraciones set pesos = '{"x":1}' where vigente_hasta is null and empresa_id = 'c2000000-0000-0000-0000-00000000000a';
  exception when check_violation then v_bloqueado := true; end;
  assert v_bloqueado, 'cambiar pesos de una versión debe fallar (inmutable)';

  v_bloqueado := false;
  begin
    update ico_configuraciones set vigente_hasta = vigente_hasta + interval '1 day' where vigente_hasta is not null and empresa_id = 'c2000000-0000-0000-0000-00000000000a';
  exception when check_violation then v_bloqueado := true; end;
  assert v_bloqueado, 'reabrir/modificar una vigencia cerrada debe fallar';

  v_bloqueado := false;
  begin
    update baremos set parametros = '{"media":1,"desviacion":1}' where empresa_id = 'c2000000-0000-0000-0000-00000000000a';
  exception when check_violation then v_bloqueado := true; end;
  assert v_bloqueado, 'cambiar parámetros de un baremo debe fallar (inmutable)';
end $$;

-- No solape: dos versiones vigentes simultáneas para el mismo cargo
do $$
declare v_bloqueado boolean := false;
begin
  begin
    insert into ico_configuraciones (empresa_id, cargo_id, pesos) values ('c2000000-0000-0000-0000-00000000000a', null, '{"a":1}');
  exception when exclusion_violation then v_bloqueado := true; end;
  assert v_bloqueado, 'dos configuraciones vigentes para el mismo (empresa, cargo) deben ser rechazadas';

  -- un cargo distinto sí puede tener la suya
  insert into ico_configuraciones (empresa_id, cargo_id, pesos)
  values ('c2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a', '{"reaccion":100}');
end $$;

-- FK compuesta: cargo de otra empresa
do $$
declare v_bloqueado boolean := false;
begin
  begin
    insert into ico_configuraciones (empresa_id, cargo_id, pesos) values ('c2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000b', '{"a":1}');
  exception when foreign_key_violation then v_bloqueado := true; end;
  assert v_bloqueado, 'un cargo de la empresa B no puede usarse en la configuración de A';
end $$;

-- Reglas de modalidad / empresa / fuente
do $$
declare v_n int := 0;
begin
  begin insert into baremos (empresa_id, modalidad, parametros, fuente) values (null, 'institucional', '{"media":1,"desviacion":1}', null);
  exception when check_violation then v_n := v_n + 1; end;
  begin insert into baremos (empresa_id, modalidad, parametros, fuente) values ('c2000000-0000-0000-0000-00000000000a', 'cientifico', '{"media":1,"desviacion":1}', 'x');
  exception when check_violation then v_n := v_n + 1; end;
  begin insert into baremos (empresa_id, modalidad, parametros, fuente) values (null, 'cientifico', '{"media":1,"desviacion":1}', '  ');
  exception when check_violation then v_n := v_n + 1; end;
  begin insert into baremos (empresa_id, modalidad, parametros) values ('c2000000-0000-0000-0000-00000000000a', 'dinamico', '{"media":1}');
  exception when check_violation then v_n := v_n + 1; end;
  assert v_n = 4, format('4 reglas de integridad de baremos deben rechazar (rechazó %s)', v_n);

  -- baremo científico global válido (con fuente)
  insert into baremos (empresa_id, modalidad, parametros, fuente)
  values (null, 'cientifico', '{"media":250,"desviacion":40}', 'Referencia de prueba');
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Admin B: no ve nada de A; ve el baremo científico global; no puede escribir en A
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000004';
do $$
declare v_bloqueado boolean := false; v_filas int;
begin
  assert (select count(*) from ico_configuraciones) = 0, 'adminB: no ve configuraciones de A';
  assert (select count(*) from baremos where empresa_id is not null) = 0, 'adminB: no ve baremos de A';
  assert (select count(*) from baremos where empresa_id is null) = 1, 'adminB: SÍ ve el baremo científico global';

  begin
    perform publicar_ico_configuracion('c2000000-0000-0000-0000-00000000000a', null, '{"hack":1}');
  exception when others then v_bloqueado := true; end;
  assert v_bloqueado, 'adminB: no puede publicar pesos en la empresa A';

  v_bloqueado := false;
  begin
    insert into baremos (empresa_id, modalidad, parametros, fuente) values (null, 'cientifico', '{"media":1,"desviacion":1}', 'x');
  exception when insufficient_privilege then v_bloqueado := true; end;
  assert v_bloqueado, 'adminB: no puede crear baremos científicos globales';
end $$;
rollback;

-- Supervisor y Operador de A: pueden LEER (evaluar), no ESCRIBIR
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000002';
do $$
declare v_bloqueado boolean := false;
begin
  assert (select count(*) from ico_configuraciones) = 3, 'supervisor: lee las configuraciones de su empresa';
  begin
    perform publicar_ico_configuracion('c2000000-0000-0000-0000-00000000000a', null, '{"a":1}');
  exception when others then v_bloqueado := true; end;
  assert v_bloqueado, 'supervisor: no puede publicar pesos (sin configuracion.editar)';
  v_bloqueado := false;
  begin
    perform publicar_baremo('c2000000-0000-0000-0000-00000000000a', null, 'dinamico', '{"ventana_dias":30,"minimo_registros":5}');
  exception when others then v_bloqueado := true; end;
  assert v_bloqueado, 'supervisor: no puede publicar baremos (sin baremos.editar)';
end $$;
rollback;

begin;
set local role app_user;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000003';
do $$
begin
  assert (select count(*) from ico_configuraciones) = 3, 'operador: lee pesos para ver su resultado';
  assert (select count(*) from baremos) = 2, 'operador: lee baremo de su empresa y el global';
end $$;
rollback;

-- Anónimo
begin;
set local role app_user;
set local request.jwt.claim.sub = '';
do $$
begin
  assert (select count(*) from ico_configuraciones) = 0, 'anónimo: sin acceso a pesos';
  assert (select count(*) from baremos) = 0, 'anónimo: sin acceso a baremos';
end $$;
rollback;

-- Super Administrador: crea baremo científico global; sin DELETE para nadie
begin;
set local role app_user;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000005';
do $$
declare v_filas int;
begin
  assert es_super_administrador(), 'super: es super administrador';
  perform publicar_baremo(null, null, 'cientifico', '{"media":260,"desviacion":45}', 'Referencia v2');
  assert (select count(*) from baremos where empresa_id is null and vigente_hasta is null) = 1, 'super: una sola versión científica vigente';
  delete from baremos where empresa_id is null;
  get diagnostics v_filas = row_count;
  assert v_filas = 0, 'nadie, ni el super, puede borrar versiones (sin política DELETE)';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Limpieza (el trigger de inmutabilidad no impide DELETE)
-- ---------------------------------------------------------------------------
delete from ico_configuraciones where empresa_id in ('c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000b');
delete from baremos where empresa_id in ('c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000b') or fuente like '%eferencia%';
delete from cargos where empresa_id in ('c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000b');
delete from areas where empresa_id in ('c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000b');
delete from usuarios_roles where empresa_id in ('c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000b');
delete from usuarios where email like 'sci-%@test';
delete from empresas where nit in ('SCI-A', 'SCI-B');
delete from auth.users where email like 'sci-%@test';

\echo 'SCIENTIFIC: TODAS LAS ASERCIONES PASARON'
