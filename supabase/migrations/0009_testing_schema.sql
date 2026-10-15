-- =============================================================================
-- Migración: 0009_testing_schema.sql
-- Módulo 5 — Testing Engine | Fase 3 §6 (pruebas versionadas, evaluaciones,
-- resultados con clave de idempotencia)
-- =============================================================================
-- Decisiones de implementación (no alteran la arquitectura aprobada):
--  1. `pruebas`/`pruebas_versiones` son catálogo GLOBAL (Fase 3 §13). Una versión
--     es inmutable salvo su `estado` (experimental → validada → obsoleta).
--  2. `evaluaciones` añade `ico_valor` e `ico_nivel`: el resultado final también
--     se guarda (junto con las versiones de configuración usadas), para que
--     los indicadores no tengan que recalcular el ICO de cada evaluación.
--  3. `resultados_pruebas` incluye `empresa_id` y `operador_id` desnormalizados
--     (los fija la función de registro) para que RLS e índices no necesiten join.
--  4. `evaluaciones.id` lo genera el cliente: es el ancla de IDEMPOTENCIA de
--     la cola offline (reenviar la misma evaluación no la duplica).
--  5. FK compuestas (id, empresa_id) como en el Módulo 3: sin referencias entre
--     empresas.
-- Idempotente.
-- =============================================================================

create table if not exists pruebas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z][a-z0-9_]{2,59}$'),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  categoria text not null check (categoria in ('atencion', 'memoria', 'velocidad', 'inhibicion')),
  descripcion text,
  estado text not null default 'activa' check (estado in ('activa', 'inactiva')),
  version_actual_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists pruebas_versiones (
  id uuid primary key default gen_random_uuid(),
  prueba_id uuid not null references pruebas(id),
  numero_version int not null check (numero_version >= 1),
  autor text not null,
  fecha_creacion timestamptz not null default now(),
  fecha_modificacion timestamptz,
  estado text not null check (estado in ('experimental', 'validada', 'obsoleta')),
  descripcion_cientifica text,
  parametros jsonb not null default '{}'::jsonb,
  funcion_puntuacion text not null,
  unique (prueba_id, numero_version)
);

create table if not exists pruebas_referencias_bibliograficas (
  id uuid primary key default gen_random_uuid(),
  prueba_version_id uuid not null references pruebas_versiones(id) on delete cascade,
  cita text not null,
  doi_url text
);

do $$
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'fk_version_actual' and table_name = 'pruebas') then
    alter table pruebas add constraint fk_version_actual foreign key (version_actual_id) references pruebas_versiones(id);
  end if;
  -- La FK que el Módulo 4 dejó pendiente (baremos.prueba_id).
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'fk_baremos_prueba' and table_name = 'baremos') then
    alter table baremos add constraint fk_baremos_prueba foreign key (prueba_id) references pruebas(id);
  end if;
end $$;

create table if not exists evaluaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  operador_id uuid not null,
  turno text not null check (length(btrim(turno)) between 1 and 60),
  fecha timestamptz not null default now(),
  dispositivo_id text check (dispositivo_id is null or length(dispositivo_id) <= 120),
  ico_configuracion_id uuid references ico_configuraciones(id),
  baremo_snapshot_id uuid references baremos(id),
  ico_valor numeric(5, 2) check (ico_valor is null or ico_valor between 0 and 100),
  ico_nivel text check (ico_nivel is null or ico_nivel in ('excelente', 'aceptable', 'requiere_atencion')),
  estado text not null default 'completa' check (estado in ('en_progreso', 'completa', 'descartada')),
  created_by uuid references usuarios(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, empresa_id),
  foreign key (operador_id, empresa_id) references operadores (id, empresa_id) on delete restrict
);

create table if not exists resultados_pruebas (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null,
  empresa_id uuid not null,
  operador_id uuid not null,
  prueba_version_id uuid not null references pruebas_versiones(id),
  intento_numero int not null default 1 check (intento_numero >= 1),
  clave_idempotencia text not null unique,
  es_valido_para_analisis boolean not null default true,
  tiempo_total_ms int check (tiempo_total_ms is null or tiempo_total_ms >= 0),
  errores_totales int check (errores_totales is null or errores_totales >= 0),
  puntaje_normalizado numeric(5, 2) check (puntaje_normalizado is null or puntaje_normalizado between 0 and 100),
  metricas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (evaluacion_id, empresa_id) references evaluaciones (id, empresa_id) on delete cascade,
  foreign key (operador_id, empresa_id) references operadores (id, empresa_id) on delete restrict
);

-- Índices (Fase 3 §14): el parcial mantiene rápido el motor estadístico aunque
-- los intentos duplicados nunca se borren.
create index if not exists idx_evaluaciones_empresa_fecha on evaluaciones (empresa_id, fecha desc);
create index if not exists idx_evaluaciones_operador_fecha on evaluaciones (operador_id, fecha desc);
create index if not exists idx_resultados_evaluacion on resultados_pruebas (evaluacion_id);
create index if not exists idx_resultados_validos on resultados_pruebas (empresa_id, prueba_version_id, created_at)
  where es_valido_para_analisis;

comment on table evaluaciones is 'Una sesión de evaluación de un operador. id generado en cliente = ancla de idempotencia.';
comment on table resultados_pruebas is 'Resultado por prueba. metricas jsonb evita columnas fijas por prueba (p3_nivel_max perdido en el legado).';

-- Una evaluación solo puede cambiar de estado; un resultado solo su validez.
create or replace function evaluaciones_solo_estado()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'estado') is distinct from (to_jsonb(old) - 'estado') then
    raise exception 'Una evaluación es inmutable salvo su estado.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function resultados_solo_validez()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'es_valido_para_analisis') is distinct from (to_jsonb(old) - 'es_valido_para_analisis') then
    raise exception 'Un resultado es inmutable salvo su validez para análisis.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function pruebas_versiones_solo_estado()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'estado' - 'fecha_modificacion') is distinct from (to_jsonb(old) - 'estado' - 'fecha_modificacion') then
    raise exception 'Una versión de prueba es inmutable salvo su estado: cree una versión nueva.' using errcode = 'check_violation';
  end if;
  new.fecha_modificacion := now();
  return new;
end;
$$;

drop trigger if exists trg_evaluaciones_inmutable on evaluaciones;
create trigger trg_evaluaciones_inmutable before update on evaluaciones for each row execute function evaluaciones_solo_estado();
drop trigger if exists trg_resultados_inmutable on resultados_pruebas;
create trigger trg_resultados_inmutable before update on resultados_pruebas for each row execute function resultados_solo_validez();
drop trigger if exists trg_pruebas_versiones_inmutable on pruebas_versiones;
create trigger trg_pruebas_versiones_inmutable before update on pruebas_versiones for each row execute function pruebas_versiones_solo_estado();
