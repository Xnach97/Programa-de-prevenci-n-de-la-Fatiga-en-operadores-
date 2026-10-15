-- Verifica el resultado de supabase/bootstrap.sql (aplicado DOS veces por run-local.sh).
\set ON_ERROR_STOP on
do $$
declare
  v_e uuid := (select id from empresas where nit = '900-BOOT-1');
  v_u constant uuid := 'a8000000-0000-0000-0000-000000000001';
begin
  assert v_e is not null, 'empresa creada';
  assert (select count(*) from empresas where nit = '900-BOOT-1') = 1, 'sin duplicar la empresa';
  assert (select nombre from empresas where id = v_e) = 'O''Boot & Cía', 'nombre con comilla y acento';
  assert exists (select 1 from configuracion_empresa where empresa_id = v_e), 'configuración creada por trigger';
  assert (select count(*) from usuarios where id = v_u) = 1 and (select empresa_id from usuarios where id = v_u) = v_e, 'perfil enlazado a Auth';
  assert (select count(*) from usuarios_roles ur join roles r on r.id = ur.role_id where ur.usuario_id = v_u and ur.empresa_id = v_e and r.nombre in ('Super Administrador', 'Administrador de empresa')) = 2, 'dos roles, sin duplicar';
  assert jsonb_array_length((select pruebas_activas from configuracion_empresa where empresa_id = v_e)) = 4, 'las 4 pruebas activas';
  assert (select count(*) from ico_configuraciones where empresa_id = v_e and vigente_hasta is null) = 1, 'ICO provisional único';
  assert (select count(*) from baremos where empresa_id = v_e and modalidad = 'institucional' and fuente like 'PROVISIONAL%') = 1, 'baremo provisional único y rotulado';
  assert (select baremo_modalidad from configuracion_empresa where empresa_id = v_e) = 'institucional', 'modalidad institucional';
  -- El administrador creado opera de verdad: ve sus permisos
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  assert tiene_permiso('configuracion.editar', v_e) and tiene_permiso('investigacion.acceder', v_e) and es_super_administrador(), 'permisos del administrador inicial';
end $$;
do $$ begin raise notice 'BOOTSTRAP: TODAS LAS ASERCIONES PASARON'; end $$;
