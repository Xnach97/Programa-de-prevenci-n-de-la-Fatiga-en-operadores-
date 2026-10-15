-- =============================================================================
-- Migración: 0007_scientific_engine_schema.sql
-- Módulo 4 — Scientific Engine | Fase 3 §7 (ico_configuraciones, baremos)
-- =============================================================================
-- Configuración VERSIONADA del motor científico. Decisión 0.2 de Fase 2: una
-- evaluación guarda referencia inmutable a la versión de pesos/baremo con que se
-- calculó; la configuración vigente cambia hacia adelante sin reescribir el pasado.
--
-- Decisiones de implementación (no alteran la arquitectura aprobada):
--  1. INMUTABILIDAD: una fila solo admite cerrar su vigencia (vigente_hasta
--     null -> fecha). Cambiar pesos/parámetros = insertar una versión nueva
--     (funciones publicar_*). No hay política DELETE para nadie.
--  2. SIN SOLAPE: una exclusión GiST impide dos versiones vigentes a la vez para
--     el mismo (empresa, cargo) o (dueño, prueba, modalidad). Así "la versión
--     vigente en la fecha X" es siempre única y reproducible.
--  3. VALIDACIÓN EN BD del jsonb (pesos y parámetros): el frontend no es la
--     última barrera (Fase 2 §1.5).
--  4. baremos.prueba_id queda SIN FK por ahora: la tabla `pruebas` pertenece al
--     Módulo 5 (Testing Engine), que añadirá la FK. prueba_id nulo = baremo del ICO.
--  5. Baremo científico: global (empresa_id nulo) y con `fuente` obligatoria.
--
-- Idempotente.
-- =============================================================================

create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Validadores de jsonb
-- -----------------------------------------------------------------------------

create or replace function validar_pesos_ico(p jsonb)
returns boolean language plpgsql immutable as $$
declare
  v_par record;
  v_suma numeric := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then
    return false;
  end if;
  for v_par in select key, value from jsonb_each(p) loop
    if jsonb_typeof(v_par.value) <> 'number' or (v_par.value #>> '{}')::numeric < 0 then
      return false;
    end if;
    v_suma := v_suma + (v_par.value #>> '{}')::numeric;
  end loop;
  return v_suma > 0;
end;
$$;

create or replace function validar_parametros_baremo(p_modalidad text, p jsonb)
returns boolean language plpgsql immutable as $$
declare
  v_numero boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  -- dirección opcional
  if p ? 'direccion' and (p->>'direccion') not in ('menor_mejor', 'mayor_mejor') then
    return false;
  end if;

  -- Todo `return` va envuelto en coalesce(..., false): un CHECK que evalúa a NULL
  -- PASA, por lo que un campo ausente (NULL en la lógica de tres valores) no
  -- puede dejarse llegar como resultado.
  if p_modalidad = 'dinamico' then
    return coalesce(jsonb_typeof(p->'ventana_dias') = 'number'
       and (p->>'ventana_dias')::numeric >= 1
       and (p->>'ventana_dias')::numeric = trunc((p->>'ventana_dias')::numeric)
       and jsonb_typeof(p->'minimo_registros') = 'number'
       and (p->>'minimo_registros')::numeric >= 2
       and (p->>'minimo_registros')::numeric = trunc((p->>'minimo_registros')::numeric), false);
  end if;

  if p_modalidad in ('institucional', 'cientifico') then
    -- Con umbrales explícitos...
    if p ? 'umbrales' then
      return coalesce(jsonb_typeof(p->'umbrales') = 'object'
         and jsonb_typeof(p->'umbrales'->'excelente') = 'number'
         and jsonb_typeof(p->'umbrales'->'atencion') = 'number'
         and case coalesce(p->>'direccion', 'menor_mejor')
               when 'menor_mejor' then (p->'umbrales'->>'excelente')::numeric <= (p->'umbrales'->>'atencion')::numeric
               else (p->'umbrales'->>'excelente')::numeric >= (p->'umbrales'->>'atencion')::numeric
             end, false);
    end if;
    -- ...o con media y desviación (> 0): límites μ ∓ σ.
    v_numero := coalesce(jsonb_typeof(p->'media') = 'number' and jsonb_typeof(p->'desviacion') = 'number', false);
    return v_numero and (p->>'desviacion')::numeric > 0;
  end if;

  return false;
end;
$$;

comment on function validar_pesos_ico(jsonb) is 'Pesos del ICO: objeto no vacío, todos numéricos ≥ 0 y suma > 0.';
comment on function validar_parametros_baremo(text, jsonb) is 'Parámetros de baremo por modalidad (espejo de statistics/baremos.js).';

-- -----------------------------------------------------------------------------
-- ico_configuraciones (Fase 3 §7)
-- -----------------------------------------------------------------------------

create table if not exists ico_configuraciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  cargo_id uuid,                                  -- null = pesos por defecto de la empresa
  pesos jsonb not null check (validar_pesos_ico(pesos)),
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz,                      -- null = vigente actualmente
  created_by uuid references usuarios(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta > vigente_desde),
  foreign key (cargo_id, empresa_id) references cargos (id, empresa_id) on delete restrict,
  constraint ico_configuraciones_sin_solape exclude using gist (
    empresa_id with =,
    (coalesce(cargo_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    tstzrange(vigente_desde, vigente_hasta) with &&
  )
);

create index if not exists idx_ico_config_lookup on ico_configuraciones (empresa_id, cargo_id, vigente_desde desc);

-- -----------------------------------------------------------------------------
-- baremos (Fase 3 §7)
-- -----------------------------------------------------------------------------

create table if not exists baremos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade,   -- null = científico global
  prueba_id uuid,                                              -- null = baremo del ICO (FK en Módulo 5)
  modalidad text not null check (modalidad in ('dinamico', 'institucional', 'cientifico')),
  parametros jsonb not null,
  fuente text,
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz,
  created_by uuid references usuarios(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (validar_parametros_baremo(modalidad, parametros)),
  check (vigente_hasta is null or vigente_hasta > vigente_desde),
  check ((modalidad = 'cientifico') = (empresa_id is null)),
  check (modalidad <> 'cientifico' or length(btrim(coalesce(fuente, ''))) > 0),
  constraint baremos_sin_solape exclude using gist (
    (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(prueba_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    modalidad with =,
    tstzrange(vigente_desde, vigente_hasta) with &&
  )
);

create index if not exists idx_baremos_lookup on baremos (empresa_id, modalidad, prueba_id, vigente_desde desc);

comment on table ico_configuraciones is 'Versiones de pesos del ICO por empresa/cargo. Inmutables salvo cierre de vigencia.';
comment on table baremos is 'Versiones de baremos (dinámico/institucional/científico). Inmutables salvo cierre de vigencia.';

-- -----------------------------------------------------------------------------
-- Inmutabilidad: solo se puede CERRAR la vigencia
-- -----------------------------------------------------------------------------

create or replace function versionado_inmutable()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'vigente_hasta') is distinct from (to_jsonb(old) - 'vigente_hasta') then
    raise exception 'Una versión de configuración es inmutable: publique una versión nueva.'
      using errcode = 'check_violation';
  end if;
  if old.vigente_hasta is not null and new.vigente_hasta is distinct from old.vigente_hasta then
    raise exception 'La vigencia de una versión ya cerrada no puede modificarse.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['ico_configuraciones', 'baremos']
  loop
    execute format('drop trigger if exists trg_%1$s_inmutable on %1$s', v_tabla);
    execute format(
      'create trigger trg_%1$s_inmutable before update on %1$s for each row execute function versionado_inmutable()',
      v_tabla
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Publicación atómica de una versión nueva (cierra la vigente e inserta)
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER: se ejecutan con los permisos (y RLS) de quien llama.

create or replace function publicar_ico_configuracion(p_empresa_id uuid, p_cargo_id uuid, p_pesos jsonb)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  update ico_configuraciones
     set vigente_hasta = now()
   where empresa_id = p_empresa_id
     and cargo_id is not distinct from p_cargo_id
     and vigente_hasta is null;

  insert into ico_configuraciones (empresa_id, cargo_id, pesos, vigente_desde)
  values (p_empresa_id, p_cargo_id, p_pesos, now())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function publicar_baremo(
  p_empresa_id uuid, p_prueba_id uuid, p_modalidad text, p_parametros jsonb, p_fuente text default null
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  update baremos
     set vigente_hasta = now()
   where empresa_id is not distinct from p_empresa_id
     and prueba_id is not distinct from p_prueba_id
     and modalidad = p_modalidad
     and vigente_hasta is null;

  insert into baremos (empresa_id, prueba_id, modalidad, parametros, fuente, vigente_desde)
  values (p_empresa_id, p_prueba_id, p_modalidad, p_parametros, p_fuente, now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function publicar_ico_configuracion(uuid, uuid, jsonb) from public;
revoke all on function publicar_baremo(uuid, uuid, text, jsonb, text) from public;
grant execute on function publicar_ico_configuracion(uuid, uuid, jsonb) to authenticated;
grant execute on function publicar_baremo(uuid, uuid, text, jsonb, text) to authenticated;
