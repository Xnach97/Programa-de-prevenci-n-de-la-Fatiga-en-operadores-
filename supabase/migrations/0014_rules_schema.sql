-- =============================================================================
-- Migración: 0014_rules_schema.sql
-- Módulo 7 — Rules Engine | Fase 3 §9 (reglas en BD, alertas, recomendaciones)
-- =============================================================================
-- Decisiones de implementación (no alteran la arquitectura aprobada):
--  1. `condicion` es un árbol JSON ESTRUCTURADO (nunca texto/código): un CHECK
--     (`validar_condicion_regla`) rechaza nodos desconocidos, profundidad > 5 o
--     más de 20 hojas. Se evalúa en `statistics/rules.js`, sin eval().
--  2. `recomendaciones_generadas` añade `empresa_id` (desnormalizado, como en
--     Testing) para que RLS no necesite join.
--  3. Una regla genera UNA alerta por evaluación (índice único) y una plantilla
--     UNA recomendación por evaluación: reenviar el mismo resultado es idempotente.
--  4. Alertas y recomendaciones se crean SOLO con `publicar_resultado_reglas`
--     (SECURITY DEFINER, valida regla/operador/evaluación de la empresa).
--  5. `alertas.gestionar` es un permiso nuevo (atender/descartar alertas).
--  6. Al anonimizar un operador, su nombre se elimina de los mensajes ya
--     generados (Ley 1581): trigger `trg_operadores_anonimizar_mensajes`.
-- Idempotente.
-- =============================================================================

-- Permiso nuevo ---------------------------------------------------------------
insert into permisos (codigo, descripcion, dominio) values
  ('alertas.gestionar', 'Atender o descartar alertas de operadores', 'alertas')
on conflict (codigo) do nothing;

insert into roles_permisos (role_id, permiso_id)
select r.id, p.id from roles r cross join permisos p
where r.es_plantilla and r.empresa_id is null
  and r.nombre in ('Super Administrador', 'Administrador de empresa', 'Supervisor SST', 'Profesional PGR')
  and p.codigo = 'alertas.gestionar'
on conflict (role_id, permiso_id) do nothing;

-- Validador estructural del árbol de condiciones -------------------------------
create or replace function validar_condicion_regla(p jsonb, p_profundidad int default 0)
returns boolean language plpgsql immutable as $$
declare
  v_clave text;
  v_hijo jsonb;
  v_ok boolean;
begin
  if p_profundidad > 5 or p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  if p ? 'and' or p ? 'or' then
    v_clave := case when p ? 'and' then 'and' else 'or' end;
    if (select count(*) from jsonb_object_keys(p)) <> 1
       or jsonb_typeof(p->v_clave) <> 'array'
       or jsonb_array_length(p->v_clave) not between 1 and 10 then
      return false;
    end if;
    for v_hijo in select * from jsonb_array_elements(p->v_clave) loop
      v_ok := validar_condicion_regla(v_hijo, p_profundidad + 1);
      if not coalesce(v_ok, false) then return false; end if;
    end loop;
    return true;
  end if;

  if p ? 'not' then
    return (select count(*) from jsonb_object_keys(p)) = 1 and coalesce(validar_condicion_regla(p->'not', p_profundidad + 1), false);
  end if;

  -- Hoja: {indicador, op, valor | percentil}
  return coalesce(
    (select array_agg(k order by k) from jsonb_object_keys(p) k) in (array['indicador','op','valor'], array['indicador','op','percentil'])
    and jsonb_typeof(p->'indicador') = 'string'
    and (p->>'indicador') ~ '^[a-z][a-z0-9_]{0,59}(\.[a-z]{1,20})?$'
    and (p->>'op') in ('<', '<=', '>', '>=', '==', '!=')
    and (
      (p ? 'valor' and jsonb_typeof(p->'valor') = 'number')
      or (p ? 'percentil' and jsonb_typeof(p->'percentil') = 'number' and (p->>'percentil')::numeric between 0 and 100)
    ),
    false);
end;
$$;

create or replace function contar_hojas_condicion(p jsonb)
returns int language sql immutable as $$
  select case
    when p ? 'and' then coalesce((select sum(contar_hojas_condicion(e)) from jsonb_array_elements(p->'and') e), 0)
    when p ? 'or'  then coalesce((select sum(contar_hojas_condicion(e)) from jsonb_array_elements(p->'or') e), 0)
    when p ? 'not' then contar_hojas_condicion(p->'not')
    else 1
  end::int
$$;

-- Tablas -----------------------------------------------------------------------
create table if not exists reglas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade,   -- null = plantilla global
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  condicion jsonb not null check (coalesce(validar_condicion_regla(condicion), false) and contar_hojas_condicion(condicion) <= 20),
  severidad text not null check (severidad in ('info', 'amarilla', 'naranja', 'roja')),
  mensaje_plantilla text not null check (length(btrim(mensaje_plantilla)) between 1 and 400),
  estado text not null default 'activa' check (estado in ('activa', 'inactiva')),
  created_by uuid references usuarios(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reglas_empresa on reglas (empresa_id) where estado = 'activa';

create table if not exists alertas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  regla_id uuid not null references reglas(id),
  operador_id uuid not null,
  evaluacion_id uuid,
  severidad text not null check (severidad in ('info', 'amarilla', 'naranja', 'roja')),
  mensaje text not null check (length(mensaje) between 1 and 600),
  estado text not null default 'abierta' check (estado in ('abierta', 'atendida', 'descartada')),
  atendida_por uuid references usuarios(id),
  atendida_en timestamptz,
  created_at timestamptz not null default now(),
  foreign key (operador_id, empresa_id) references operadores (id, empresa_id) on delete restrict,
  foreign key (evaluacion_id, empresa_id) references evaluaciones (id, empresa_id) on delete cascade
);
create unique index if not exists uq_alertas_regla_evaluacion on alertas (regla_id, evaluacion_id) where evaluacion_id is not null;
create index if not exists idx_alertas_empresa_estado on alertas (empresa_id, estado, created_at desc);

create table if not exists recomendaciones_plantillas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade,   -- null = plantilla global
  codigo text not null check (codigo ~ '^[a-z][a-z0-9_]{2,59}$'),
  titulo text not null check (length(btrim(titulo)) between 1 and 120),
  texto text not null check (length(btrim(texto)) between 1 and 600),
  condicion_activacion jsonb not null check (coalesce(validar_condicion_regla(condicion_activacion), false) and contar_hojas_condicion(condicion_activacion) <= 20)
);
create unique index if not exists uq_recomendaciones_plantillas_codigo
  on recomendaciones_plantillas (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo);

create table if not exists recomendaciones_generadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  evaluacion_id uuid not null,
  plantilla_id uuid not null references recomendaciones_plantillas(id),
  texto_resuelto text not null check (length(texto_resuelto) between 1 and 800),
  created_at timestamptz not null default now(),
  foreign key (evaluacion_id, empresa_id) references evaluaciones (id, empresa_id) on delete cascade,
  unique (evaluacion_id, plantilla_id)
);

-- updated_at de reglas
drop trigger if exists trg_reglas_updated_at on reglas;
create trigger trg_reglas_updated_at before update on reglas for each row execute function set_updated_at();

-- Una alerta solo cambia de estado (y quién/cuándo la atendió) ------------------
create or replace function alertas_solo_estado()
returns trigger language plpgsql as $$
begin
  -- Única excepción: la anonimización de un operador depura el nombre del mensaje
  -- (la bandera es local a la transacción y solo la activa `operadores_limpiar_mensajes`).
  if coalesce(current_setting('neurolab.anonimizando', true), '') = 'on' then
    if (new.id, new.empresa_id, new.regla_id, new.operador_id, new.evaluacion_id, new.severidad, new.estado, new.created_at)
       is distinct from (old.id, old.empresa_id, old.regla_id, old.operador_id, old.evaluacion_id, old.severidad, old.estado, old.created_at) then
      raise exception 'La anonimización solo puede modificar el texto del mensaje.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.empresa_id, new.regla_id, new.operador_id, new.evaluacion_id, new.severidad, new.mensaje, new.created_at)
     is distinct from (old.id, old.empresa_id, old.regla_id, old.operador_id, old.evaluacion_id, old.severidad, old.mensaje, old.created_at) then
    raise exception 'Una alerta solo puede cambiar de estado.' using errcode = 'check_violation';
  end if;
  if old.estado <> 'abierta' and new.estado is distinct from old.estado then
    raise exception 'Una alerta ya resuelta no puede cambiar de estado.' using errcode = 'check_violation';
  end if;
  if new.estado <> 'abierta' then
    new.atendida_por := coalesce(new.atendida_por, auth.uid());
    new.atendida_en := coalesce(new.atendida_en, now());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_alertas_solo_estado on alertas;
create trigger trg_alertas_solo_estado before update on alertas for each row execute function alertas_solo_estado();

-- RLS -------------------------------------------------------------------------
alter table reglas enable row level security;
alter table alertas enable row level security;
alter table recomendaciones_plantillas enable row level security;
alter table recomendaciones_generadas enable row level security;

drop policy if exists reglas_select on reglas;
create policy reglas_select on reglas for select
  using (auth.uid() is not null and (empresa_id is null or empresa_id in (select empresas_del_usuario()) or es_super_administrador()));
drop policy if exists reglas_write on reglas;
create policy reglas_write on reglas for all
  using ((empresa_id is not null and tiene_permiso('configuracion.editar', empresa_id)) or es_super_administrador())
  with check ((empresa_id is not null and tiene_permiso('configuracion.editar', empresa_id)) or es_super_administrador());

drop policy if exists plantillas_select on recomendaciones_plantillas;
create policy plantillas_select on recomendaciones_plantillas for select
  using (auth.uid() is not null and (empresa_id is null or empresa_id in (select empresas_del_usuario()) or es_super_administrador()));
drop policy if exists plantillas_write on recomendaciones_plantillas;
create policy plantillas_write on recomendaciones_plantillas for all
  using ((empresa_id is not null and tiene_permiso('configuracion.editar', empresa_id)) or es_super_administrador())
  with check ((empresa_id is not null and tiene_permiso('configuracion.editar', empresa_id)) or es_super_administrador());

drop policy if exists alertas_select on alertas;
create policy alertas_select on alertas for select
  using (tiene_permiso('evaluaciones.ver', empresa_id) or tiene_permiso('alertas.gestionar', empresa_id) or es_super_administrador());
drop policy if exists alertas_update on alertas;
create policy alertas_update on alertas for update
  using (tiene_permiso('alertas.gestionar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('alertas.gestionar', empresa_id) or es_super_administrador());
-- Sin INSERT/DELETE directos: solo publicar_resultado_reglas crea alertas.

drop policy if exists recomendaciones_select on recomendaciones_generadas;
create policy recomendaciones_select on recomendaciones_generadas for select
  using (tiene_permiso('evaluaciones.ver', empresa_id) or es_super_administrador());

-- publicar_resultado_reglas ---------------------------------------------------
-- p_alertas = [{regla_id, operador_id, evaluacion_id, severidad, mensaje}]
-- p_recomendaciones = [{evaluacion_id, plantilla_id, texto}]
create or replace function publicar_resultado_reglas(p_empresa uuid, p_alertas jsonb, p_recomendaciones jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_regla reglas%rowtype;
  v_eval uuid;
  v_op uuid;
  v_na int := 0;
  v_nr int := 0;
  v_filas int;
begin
  if p_empresa is null or not (tiene_permiso('evaluaciones.registrar', p_empresa) or es_super_administrador()) then
    raise exception 'publicar_resultado_reglas: sin permiso para la empresa.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(coalesce(p_alertas, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_recomendaciones, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_alertas, '[]'::jsonb)) > 200 or jsonb_array_length(coalesce(p_recomendaciones, '[]'::jsonb)) > 200 then
    raise exception 'publicar_resultado_reglas: entrada inválida.' using errcode = 'invalid_parameter_value';
  end if;

  for v in select * from jsonb_array_elements(coalesce(p_alertas, '[]'::jsonb)) loop
    select * into v_regla from reglas where id = (v->>'regla_id')::uuid and (empresa_id = p_empresa or empresa_id is null) and estado = 'activa';
    if not found then
      raise exception 'publicar_resultado_reglas: regla inexistente o inactiva.' using errcode = 'foreign_key_violation';
    end if;
    v_eval := (v->>'evaluacion_id')::uuid;
    v_op := (v->>'operador_id')::uuid;
    if v_eval is null or not exists (select 1 from evaluaciones where id = v_eval and empresa_id = p_empresa and operador_id = v_op) then
      raise exception 'publicar_resultado_reglas: la evaluación no corresponde al operador y la empresa.' using errcode = 'foreign_key_violation';
    end if;
    insert into alertas (empresa_id, regla_id, operador_id, evaluacion_id, severidad, mensaje)
    values (p_empresa, v_regla.id, v_op, v_eval, v_regla.severidad, left(v->>'mensaje', 600))   -- la severidad la fija la REGLA, no el cliente
    on conflict (regla_id, evaluacion_id) where evaluacion_id is not null do nothing;
    get diagnostics v_filas = row_count;
    v_na := v_na + v_filas;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_recomendaciones, '[]'::jsonb)) loop
    v_eval := (v->>'evaluacion_id')::uuid;
    if not exists (select 1 from evaluaciones where id = v_eval and empresa_id = p_empresa) then
      raise exception 'publicar_resultado_reglas: evaluación ajena.' using errcode = 'foreign_key_violation';
    end if;
    if not exists (select 1 from recomendaciones_plantillas where id = (v->>'plantilla_id')::uuid and (empresa_id = p_empresa or empresa_id is null)) then
      raise exception 'publicar_resultado_reglas: plantilla inexistente.' using errcode = 'foreign_key_violation';
    end if;
    insert into recomendaciones_generadas (empresa_id, evaluacion_id, plantilla_id, texto_resuelto)
    values (p_empresa, v_eval, (v->>'plantilla_id')::uuid, left(v->>'texto', 800))
    on conflict (evaluacion_id, plantilla_id) do nothing;
    get diagnostics v_filas = row_count;
    v_nr := v_nr + v_filas;
  end loop;

  return jsonb_build_object('alertas', v_na, 'recomendaciones', v_nr);
end;
$$;
revoke all on function publicar_resultado_reglas(uuid, jsonb, jsonb) from public;
grant execute on function publicar_resultado_reglas(uuid, jsonb, jsonb) to authenticated;

-- Anonimización: el nombre del operador desaparece de los textos ya generados ----
create or replace function operadores_limpiar_mensajes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nombre text := btrim(coalesce(old.nombre, '') || ' ' || coalesce(old.apellido, ''));
begin
  if v_nombre <> '' then
    perform set_config('neurolab.anonimizando', 'on', true);
    update alertas set mensaje = replace(mensaje, v_nombre, 'Operador anonimizado') where operador_id = old.id and mensaje like '%' || v_nombre || '%';
    update recomendaciones_generadas set texto_resuelto = replace(texto_resuelto, v_nombre, 'Operador anonimizado')
     where evaluacion_id in (select id from evaluaciones where operador_id = old.id) and texto_resuelto like '%' || v_nombre || '%';
    perform set_config('neurolab.anonimizando', 'off', true);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_operadores_anonimizar_mensajes on operadores;
create trigger trg_operadores_anonimizar_mensajes
  after update on operadores for each row
  when (old.estado is distinct from 'anonimizado' and new.estado = 'anonimizado')
  execute function operadores_limpiar_mensajes();
