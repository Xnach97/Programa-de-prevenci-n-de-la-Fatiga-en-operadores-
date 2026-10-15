-- =============================================================================
-- Migración: 0012_indicators_schema.sql
-- Módulo 6 — Indicators | Fase 3 §8
-- =============================================================================
-- `indicadores_valores` es el ÚNICO punto de lectura de los dashboards: ninguna
-- vista hace AVG() sobre resultados_pruebas.
--
-- Decisiones de implementación (no alteran la arquitectura aprobada):
--  1. Un valor es único por (empresa, indicador, ámbito, periodo): recalcular
--     un periodo lo SOBRESCRIBE (upsert) en vez de acumular duplicados.
--  2. Para el ámbito 'empresa', `ambito_id` = el id de la empresa (así la
--     unicidad no depende de NULL).
--  3. El ámbito 'turno' de Fase 3 no se materializa: `turno` es texto libre, no
--     un uuid; los dashboards filtran turno sobre `evaluaciones`.
--  4. La función `publicar_indicadores` valida que cada ámbito pertenezca a la
--     empresa (el ámbito polimórfico no tiene FK) y que el valor sea finito.
-- Idempotente.
-- =============================================================================

create table if not exists indicadores_definiciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z][a-z0-9_]{2,59}$'),
  nombre text not null,
  ambito text not null check (ambito in ('operador', 'empresa', 'area', 'turno', 'cargo')),
  formula_ref text not null check (length(btrim(formula_ref)) > 0),
  descripcion text
);

create table if not exists indicadores_valores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  indicador_id uuid not null references indicadores_definiciones(id),
  ambito_id uuid not null,
  periodo daterange not null check (not isempty(periodo) and lower_inc(periodo) and not upper_inc(periodo)),
  valor numeric(10, 3) not null,
  detalle jsonb not null default '{}'::jsonb,
  calculado_en timestamptz not null default now()
);

create unique index if not exists uq_indicadores_valores
  on indicadores_valores (empresa_id, indicador_id, ambito_id, periodo);
create index if not exists idx_indicadores_lookup
  on indicadores_valores (empresa_id, indicador_id, ambito_id, periodo);
create index if not exists idx_indicadores_periodo
  on indicadores_valores using gist (periodo);

alter table indicadores_definiciones enable row level security;
alter table indicadores_valores enable row level security;

drop policy if exists indicadores_def_select on indicadores_definiciones;
create policy indicadores_def_select on indicadores_definiciones for select using (auth.uid() is not null);
drop policy if exists indicadores_def_write on indicadores_definiciones;
create policy indicadores_def_write on indicadores_definiciones for all
  using (es_super_administrador()) with check (es_super_administrador());

drop policy if exists indicadores_val_select on indicadores_valores;
create policy indicadores_val_select on indicadores_valores for select
  using (tiene_permiso('evaluaciones.ver', empresa_id) or es_super_administrador());
-- Sin políticas de escritura: solo `publicar_indicadores` (SECURITY DEFINER) escribe.

-- -----------------------------------------------------------------------------
-- publicar_indicadores(p_empresa, p_valores)
-- p_valores = [{codigo, ambito_id, desde, hasta, valor, detalle}]   (hasta exclusivo)
-- Quien registra evaluaciones (modo quiosco incluido) puede recalcular los
-- indicadores derivados; nadie más escribe.
-- -----------------------------------------------------------------------------
create or replace function publicar_indicadores(p_empresa uuid, p_valores jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_def indicadores_definiciones%rowtype;
  v_ambito uuid;
  v_valor numeric;
  v_desde date;
  v_hasta date;
  v_n int := 0;
begin
  if p_empresa is null or not (tiene_permiso('evaluaciones.registrar', p_empresa) or es_super_administrador()) then
    raise exception 'publicar_indicadores: sin permiso para la empresa.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_valores) <> 'array' then
    raise exception 'publicar_indicadores: p_valores debe ser un arreglo.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_valores) > 5000 then
    raise exception 'publicar_indicadores: demasiados valores en una llamada.' using errcode = 'invalid_parameter_value';
  end if;

  for v in select * from jsonb_array_elements(p_valores) loop
    select * into v_def from indicadores_definiciones where codigo = v->>'codigo';
    if not found then
      raise exception 'publicar_indicadores: indicador desconocido.' using errcode = 'invalid_parameter_value';
    end if;
    v_ambito := (v->>'ambito_id')::uuid;
    v_valor := (v->>'valor')::numeric;
    v_desde := (v->>'desde')::date;
    v_hasta := (v->>'hasta')::date;
    if v_valor is null or v_valor in ('NaN'::numeric) or abs(v_valor) >= 10000000 then
      raise exception 'publicar_indicadores: valor inválido.' using errcode = 'invalid_parameter_value';
    end if;
    if v_desde is null or v_hasta is null or v_hasta <= v_desde then
      raise exception 'publicar_indicadores: periodo inválido.' using errcode = 'invalid_parameter_value';
    end if;

    -- El ámbito polimórfico se valida aquí (no hay FK).
    if not coalesce(case v_def.ambito
        when 'operador' then exists (select 1 from operadores where id = v_ambito and empresa_id = p_empresa)
        when 'area'     then exists (select 1 from areas where id = v_ambito and empresa_id = p_empresa)
        when 'cargo'    then exists (select 1 from cargos where id = v_ambito and empresa_id = p_empresa)
        when 'empresa'  then v_ambito = p_empresa
        else false
      end, false) then
      raise exception 'publicar_indicadores: el ámbito no pertenece a la empresa.' using errcode = 'foreign_key_violation';
    end if;

    insert into indicadores_valores (empresa_id, indicador_id, ambito_id, periodo, valor, detalle, calculado_en)
    values (p_empresa, v_def.id, v_ambito, daterange(v_desde, v_hasta, '[)'), v_valor, coalesce(v->'detalle', '{}'::jsonb), now())
    on conflict (empresa_id, indicador_id, ambito_id, periodo)
    do update set valor = excluded.valor, detalle = excluded.detalle, calculado_en = excluded.calculado_en;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function publicar_indicadores(uuid, jsonb) from public;
grant execute on function publicar_indicadores(uuid, jsonb) to authenticated;
