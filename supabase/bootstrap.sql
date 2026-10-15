-- =============================================================================
-- supabase/bootstrap.sql
-- Alta de la PRIMERA empresa y de su administrador. Se ejecuta UNA vez, después de
-- aplicar las migraciones (supabase/instalacion.sql) y de crear el usuario en
-- Supabase → Authentication → Users ("Add user", con correo y contraseña).
--
-- Dos formas de usarlo:
--   a) scripts/instalar.mjs lo ejecuta por usted (--empresa, --nit, --admin-email).
--   b) A mano en Supabase → SQL Editor: en el bloque de abajo reemplace los tres textos
--      entre guiones bajos dobles (EMPRESA, NIT y ADMIN_EMAIL) por sus datos y pulse "Run".
--
-- Idempotente: puede repetirse; no duplica empresa, usuario ni roles.
-- Asigna al usuario los roles "Super Administrador" (todas las empresas y permisos)
-- y "Administrador de empresa". El resto de usuarios se crean luego desde la app
-- (o con el mismo procedimiento) y reciben los roles que corresponda.
--
-- Opcional (SEMBRAR_PROVISIONAL = 'si'): siembra pesos del ICO iguales y un baremo
-- INSTITUCIONAL PROVISIONAL (excelente ≥ 80, atención ≥ 55) para que el ICO se calcule
-- desde el primer día. NO son parámetros científicos: debe sustituirlos desde
-- Configuración cuando el profesional SST defina los de la empresa.
-- =============================================================================
do $$
declare
  c_empresa constant text := '__EMPRESA__';
  c_nit constant text := '__NIT__';
  c_email constant text := lower('__ADMIN_EMAIL__');
  c_sembrar constant text := '__SEMBRAR_PROVISIONAL__';
  v_user auth.users%rowtype;
  v_empresa uuid;
  v_pesos jsonb;
begin
  if c_empresa like '\_\_%' or c_nit like '\_\_%' or c_email like '\_\_%' then
    raise exception 'bootstrap: reemplace los marcadores __EMPRESA__, __NIT__ y __ADMIN_EMAIL__.';
  end if;

  select * into v_user from auth.users where lower(email) = c_email;
  if not found then
    raise exception 'bootstrap: no existe un usuario de Authentication con el correo %. Créelo primero en Authentication → Users.', c_email;
  end if;

  -- Empresa (el trigger crea su configuracion_empresa)
  select id into v_empresa from empresas where nit = c_nit;
  if v_empresa is null then
    insert into empresas (nombre, nit) values (c_empresa, c_nit) returning id into v_empresa;
  end if;

  -- Perfil del usuario (1:1 con Auth)
  insert into usuarios (id, empresa_id, nombre_completo, email)
  values (v_user.id, v_empresa, split_part(v_user.email, '@', 1), v_user.email)
  on conflict (id) do nothing;

  -- Roles de plantilla
  insert into usuarios_roles (usuario_id, role_id, empresa_id)
  select v_user.id, r.id, v_empresa from roles r
   where r.es_plantilla and r.empresa_id is null and r.nombre in ('Super Administrador', 'Administrador de empresa')
  on conflict do nothing;

  -- Pruebas activas: todas las del catálogo (se pueden restringir en Configuración)
  update configuracion_empresa
     set pruebas_activas = (select coalesce(jsonb_agg(codigo order by codigo), '[]'::jsonb) from pruebas where estado = 'activa')
   where empresa_id = v_empresa and pruebas_activas = '[]'::jsonb;

  if lower(c_sembrar) = 'si' then
    select jsonb_object_agg(codigo, 1) into v_pesos from pruebas where estado = 'activa';
    if v_pesos is not null and not exists (select 1 from ico_configuraciones where empresa_id = v_empresa and cargo_id is null and vigente_hasta is null) then
      insert into ico_configuraciones (empresa_id, cargo_id, pesos) values (v_empresa, null, v_pesos);
    end if;
    if not exists (select 1 from baremos where empresa_id = v_empresa and prueba_id is null and modalidad = 'institucional' and vigente_hasta is null) then
      insert into baremos (empresa_id, prueba_id, modalidad, parametros, fuente)
      values (v_empresa, null, 'institucional', '{"direccion":"mayor_mejor","umbrales":{"excelente":80,"atencion":55}}'::jsonb,
              'PROVISIONAL – sembrado por la instalación; sustituir por parámetros definidos por el profesional SST');
    end if;
    update configuracion_empresa set baremo_modalidad = 'institucional' where empresa_id = v_empresa;
  end if;

  raise notice 'Empresa "%" lista (id %). Administrador: %', c_empresa, v_empresa, c_email;
end $$;
