-- =============================================================================
-- Migración: 0018_research.sql
-- Módulo 10 — Research Platform | Fase 3 §11 (cohortes, consentimientos, exportes)
-- =============================================================================
-- Decisiones de implementación (no alteran la arquitectura aprobada):
--  1. `consentimientos` es un HISTORIAL append-only: revocar = insertar una fila
--     `otorgado = false`. El consentimiento vigente es la fila más reciente por
--     (operador, propósito). 'evaluacion_sst' y 'investigacion_cientifica' son
--     propósitos distintos y nunca se mezclan (Fase 3 §11).
--  2. Un operador solo puede estar en una cohorte con consentimiento de
--     investigación VIGENTE (trigger). Al revocar, sale de todas las cohortes.
--  3. Todos los datos tienen `empresa_id` y FKs compuestas (aislamiento multiempresa).
--  4. `exportar_dataset` (SECURITY DEFINER) es la ÚNICA vía de exportación:
--       - exige `datos.exportar` + `investigacion.acceder` en la empresa;
--       - solo cohortes con >= 5 participantes con consentimiento (anti-reidentificación);
--       - pseudónimos por exportación (sha256 con el id del dataset): no enlazables
--         entre exportes y sin identidad directa (sin cédula, nombre, área ni cargo);
--       - registra el exporte en `datasets_exportados` y en `auditoria` en la MISMA
--         transacción: no se puede exportar sin dejar rastro.
-- Idempotente.
-- =============================================================================

create table if not exists cohortes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  criterio jsonb check (criterio is null or jsonb_typeof(criterio) = 'object'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, empresa_id)
);
create unique index if not exists uq_cohortes_nombre on cohortes (empresa_id, lower(btrim(nombre)));

create table if not exists cohortes_operadores (
  cohorte_id uuid not null,
  empresa_id uuid not null,
  operador_id uuid not null,
  incluido_en timestamptz not null default now(),
  primary key (cohorte_id, operador_id),
  foreign key (cohorte_id, empresa_id) references cohortes (id, empresa_id) on delete cascade,
  foreign key (operador_id, empresa_id) references operadores (id, empresa_id) on delete cascade
);

create table if not exists consentimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  operador_id uuid not null,
  proposito text not null check (proposito in ('evaluacion_sst', 'investigacion_cientifica')),
  otorgado boolean not null,
  documento_url text check (documento_url is null or documento_url ~* '^https://'),
  fecha timestamptz not null default clock_timestamp(), -- orden total del historial incluso dentro de una transacción
  registrado_por uuid default auth.uid(),
  foreign key (operador_id, empresa_id) references operadores (id, empresa_id) on delete cascade
);
create index if not exists idx_consentimientos_operador on consentimientos (operador_id, proposito, fecha desc);

create table if not exists datasets_exportados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  solicitado_por uuid not null,
  cohorte_id uuid,
  anonimizado boolean not null default true,
  filtros jsonb,
  filas int not null default 0,
  created_at timestamptz not null default now(),
  foreign key (cohorte_id, empresa_id) references cohortes (id, empresa_id) on delete set null (cohorte_id)
);

-- Historial inmutable de consentimientos (los exportes no tienen políticas de UPDATE/DELETE) ---
create or replace function research_inmutable()
returns trigger language plpgsql as $$
begin
  -- Una cascada de FK (borrado de empresa/operador por el motor) corre anidada: se permite.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% es un registro histórico: no admite UPDATE ni DELETE.', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;
drop trigger if exists trg_inmutable on consentimientos;
create trigger trg_inmutable before update or delete on consentimientos
  for each row execute function research_inmutable();

-- Consentimiento vigente ------------------------------------------------------
create or replace function consentimiento_vigente(p_operador uuid, p_proposito text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.otorgado from consentimientos c
                    where c.operador_id = p_operador and c.proposito = p_proposito
                    order by c.fecha desc, c.id desc limit 1), false)
$$;
revoke all on function consentimiento_vigente(uuid, text) from public;
grant execute on function consentimiento_vigente(uuid, text) to authenticated;

-- Regla: solo con consentimiento de investigación vigente -----------------------
create or replace function cohortes_validar_consentimiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not consentimiento_vigente(new.operador_id, 'investigacion_cientifica') then
    raise exception 'El operador no tiene consentimiento vigente para investigación.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cohortes_consentimiento on cohortes_operadores;
create trigger trg_cohortes_consentimiento before insert on cohortes_operadores
  for each row execute function cohortes_validar_consentimiento();

-- Revocar consentimiento de investigación = salir de todas las cohortes ---------
create or replace function consentimientos_revocar_cohortes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.proposito = 'investigacion_cientifica' and new.otorgado = false then
    delete from cohortes_operadores where operador_id = new.operador_id and empresa_id = new.empresa_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_consentimientos_revocar on consentimientos;
create trigger trg_consentimientos_revocar after insert on consentimientos
  for each row execute function consentimientos_revocar_cohortes();

-- RLS --------------------------------------------------------------------------
alter table cohortes enable row level security;
alter table cohortes_operadores enable row level security;
alter table consentimientos enable row level security;
alter table datasets_exportados enable row level security;

drop policy if exists cohortes_select on cohortes;
create policy cohortes_select on cohortes for select using (tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());
drop policy if exists cohortes_insert on cohortes;
create policy cohortes_insert on cohortes for insert with check (tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());
drop policy if exists cohortes_delete on cohortes;
create policy cohortes_delete on cohortes for delete using (tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());

drop policy if exists cohortes_op_select on cohortes_operadores;
create policy cohortes_op_select on cohortes_operadores for select using (tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());
drop policy if exists cohortes_op_insert on cohortes_operadores;
create policy cohortes_op_insert on cohortes_operadores for insert with check (tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());
drop policy if exists cohortes_op_delete on cohortes_operadores;
create policy cohortes_op_delete on cohortes_operadores for delete using (tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());

-- Consentimientos: ver con operadores.ver o investigacion.acceder; registrar con operadores.administrar.
drop policy if exists consentimientos_select on consentimientos;
create policy consentimientos_select on consentimientos for select
  using (tiene_permiso('operadores.ver', empresa_id) or tiene_permiso('investigacion.acceder', empresa_id) or es_super_administrador());
drop policy if exists consentimientos_insert on consentimientos;
create policy consentimientos_insert on consentimientos for insert
  with check (tiene_permiso('operadores.administrar', empresa_id) or es_super_administrador());

-- Exportes: solo lectura para quien puede exportar; se insertan únicamente vía exportar_dataset().
drop policy if exists datasets_select on datasets_exportados;
create policy datasets_select on datasets_exportados for select using (tiene_permiso('datos.exportar', empresa_id) or es_super_administrador());

-- Poblar una cohorte según su criterio (area_id / cargo_id) ---------------------
-- SECURITY DEFINER: el investigador NO necesita `operadores.ver` (no ve identidades); se exige
-- `investigacion.acceder` en la empresa de la cohorte. Solo entran operadores ACTIVOS con
-- consentimiento de investigación vigente.
create or replace function poblar_cohorte(p_cohorte uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c cohortes%rowtype;
  v_n int;
begin
  select * into v_c from cohortes where id = p_cohorte;
  if not found or not (tiene_permiso('investigacion.acceder', v_c.empresa_id) or es_super_administrador()) then
    raise exception 'poblar_cohorte: cohorte inexistente o sin acceso.' using errcode = 'no_data_found';
  end if;
  insert into cohortes_operadores (cohorte_id, empresa_id, operador_id)
  select v_c.id, v_c.empresa_id, o.id
    from operadores o
   where o.empresa_id = v_c.empresa_id
     and o.estado = 'activo'
     and (v_c.criterio->>'area_id' is null or o.area_id = (v_c.criterio->>'area_id')::uuid)
     and (v_c.criterio->>'cargo_id' is null or o.cargo_id = (v_c.criterio->>'cargo_id')::uuid)
     and consentimiento_vigente(o.id, 'investigacion_cientifica')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function poblar_cohorte(uuid) from public;
grant execute on function poblar_cohorte(uuid) to authenticated;

-- Exportación anonimizada ---------------------------------------------------------
create or replace function exportar_dataset(p_empresa uuid, p_cohorte uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_minimo constant int := 5;
  c_maximo constant int := 50000;
  v_dataset uuid := gen_random_uuid();
  v_participantes int;
  v_filas jsonb;
  v_n int;
begin
  if p_empresa is null or not (tiene_permiso('datos.exportar', p_empresa) and tiene_permiso('investigacion.acceder', p_empresa)) and not es_super_administrador() then
    raise exception 'exportar_dataset: se requieren datos.exportar e investigacion.acceder.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from cohortes where id = p_cohorte and empresa_id = p_empresa) then
    raise exception 'exportar_dataset: la cohorte no pertenece a la empresa.' using errcode = 'no_data_found';
  end if;
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then
    raise exception 'exportar_dataset: rango de fechas invertido.' using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_participantes
    from cohortes_operadores co
   where co.cohorte_id = p_cohorte and consentimiento_vigente(co.operador_id, 'investigacion_cientifica');
  if v_participantes < c_minimo then
    raise exception 'exportar_dataset: la cohorte tiene % participantes con consentimiento; el mínimo para anonimizar es %.', v_participantes, c_minimo
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(f.fila order by f.orden), '[]'::jsonb), count(*)
    into v_filas, v_n
    from (
      select r.created_at as orden,
             jsonb_build_object(
               'participante', substr(encode(sha256(convert_to(v_dataset::text || co.operador_id::text, 'UTF8')), 'hex'), 1, 12),
               'fecha', fecha_local(e.fecha),
               'turno', e.turno,
               'prueba', p.codigo,
               'intento', r.intento_numero,
               'valido_para_analisis', r.es_valido_para_analisis,
               'tiempo_total_ms', r.tiempo_total_ms,
               'errores_totales', r.errores_totales,
               'puntaje_normalizado', r.puntaje_normalizado,
               'ico_valor', e.ico_valor,
               'ico_nivel', e.ico_nivel
             ) as fila
        from cohortes_operadores co
        join evaluaciones e on e.operador_id = co.operador_id and e.empresa_id = co.empresa_id and e.estado = 'completa'
        join resultados_pruebas r on r.evaluacion_id = e.id
        join pruebas_versiones pv on pv.id = r.prueba_version_id
        join pruebas p on p.id = pv.prueba_id
       where co.cohorte_id = p_cohorte
         and consentimiento_vigente(co.operador_id, 'investigacion_cientifica')
         and (p_desde is null or fecha_local(e.fecha) >= p_desde)
         and (p_hasta is null or fecha_local(e.fecha) <= p_hasta)
       limit c_maximo + 1
    ) f;
  if v_n > c_maximo then
    raise exception 'exportar_dataset: el dataset supera % filas; acote el rango de fechas.', c_maximo using errcode = 'program_limit_exceeded';
  end if;

  insert into datasets_exportados (id, empresa_id, solicitado_por, cohorte_id, anonimizado, filtros, filas)
  values (v_dataset, p_empresa, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), p_cohorte, true,
          jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'participantes', v_participantes), v_n);
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, detalle_nuevo, ip)
  values (p_empresa, auditoria_usuario(), 'dataset.exportar', 'datasets_exportados', v_dataset,
          jsonb_build_object('cohorte_id', p_cohorte, 'filas', v_n, 'participantes', v_participantes, 'desde', p_desde, 'hasta', p_hasta), auditoria_ip());

  return jsonb_build_object('dataset_id', v_dataset, 'participantes', v_participantes, 'filas', v_filas);
end;
$$;
revoke all on function exportar_dataset(uuid, uuid, date, date) from public;
grant execute on function exportar_dataset(uuid, uuid, date, date) to authenticated;
