-- =============================================================================
-- Migración: 0004_organization_schema.sql
-- Módulo 3 — Organization | Dominio DDD: Organization Catalogs (Fase 3 §5)
-- =============================================================================
-- Crea los 5 catálogos organizacionales (áreas, cargos, centros de trabajo,
-- procesos, líneas operacionales) y la tabla `operadores`, con el trigger de
-- anonimización de la decisión 0.6 de Fase 2 (Ley 1581, habeas data).
--
-- Decisiones de implementación sobre detalles que Fase 3 §5 dejó abiertos
-- (ninguna cambia la arquitectura aprobada):
--
--  1. FKs COMPUESTAS (id, empresa_id). Una FK simple `cargos.area_id ->
--     areas(id)` permitiría que un cargo de la empresa A apunte a un área de la
--     empresa B: una fuga entre tenants que RLS no puede detectar porque cada
--     fila individual es "legítima". La FK compuesta obliga a que padre e hijo
--     compartan empresa_id. Con la columna hija nula, Postgres (MATCH SIMPLE)
--     no evalúa la FK, de modo que las relaciones opcionales siguen siendo
--     opcionales.
--  2. UNICIDAD de nombre por empresa e insensible a mayúsculas, para que el
--     catálogo unificado (Fase 1 §5 #4) no acumule "Sala de Mandos" y "sala de
--     mandos" como entradas distintas.
--  3. `estado` admite activo/inactivo/archivado (Fase 3 §2). Un catálogo en uso
--     solo puede desactivarse; el borrado físico lo impide la FK ON DELETE
--     RESTRICT.
--
-- Idempotente: seguro de ejecutar más de una vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilidad compartida: mantiene updated_at (Fase 3 §2: created_at/updated_at en
-- todas las tablas).
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is 'Trigger genérico: actualiza updated_at en cada UPDATE.';

-- -----------------------------------------------------------------------------
-- Catálogos (Fase 3 §5)
-- -----------------------------------------------------------------------------

create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, empresa_id)
);

create table if not exists procesos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, empresa_id)
);

create table if not exists centros_trabajo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, empresa_id)
);

create table if not exists cargos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  area_id uuid,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, empresa_id),
  foreign key (area_id, empresa_id) references areas (id, empresa_id) on delete restrict
);

create table if not exists lineas_operacionales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  proceso_id uuid,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, empresa_id),
  foreign key (proceso_id, empresa_id) references procesos (id, empresa_id) on delete restrict
);

comment on table areas is 'Catálogo de áreas (Fase 3 §5). Administrado desde admin/catalogos.js; nunca escrito en JS.';
comment on table cargos is 'Catálogo de cargos; area_id opcional y de la misma empresa (FK compuesta).';
comment on table lineas_operacionales is 'Catálogo de líneas operacionales; proceso_id opcional y de la misma empresa (FK compuesta).';

-- Unicidad de nombre por empresa, insensible a mayúsculas.
create unique index if not exists areas_empresa_nombre_uk on areas (empresa_id, lower(btrim(nombre)));
create unique index if not exists procesos_empresa_nombre_uk on procesos (empresa_id, lower(btrim(nombre)));
create unique index if not exists centros_trabajo_empresa_nombre_uk on centros_trabajo (empresa_id, lower(btrim(nombre)));
create unique index if not exists cargos_empresa_nombre_uk on cargos (empresa_id, lower(btrim(nombre)));
create unique index if not exists lineas_empresa_nombre_uk on lineas_operacionales (empresa_id, lower(btrim(nombre)));

create index if not exists idx_cargos_area on cargos (area_id);
create index if not exists idx_lineas_proceso on lineas_operacionales (proceso_id);

-- -----------------------------------------------------------------------------
-- Operadores (Fase 3 §5)
-- -----------------------------------------------------------------------------

create table if not exists operadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  usuario_id uuid references usuarios(id), -- null si el operador no tiene cuenta propia (modo kiosco)
  cedula text not null check (length(btrim(cedula)) between 1 and 60),
  nombre text check (nombre is null or length(btrim(nombre)) between 1 and 120),
  apellido text check (apellido is null or length(btrim(apellido)) between 1 and 120),
  cargo_id uuid,
  area_id uuid,
  centro_trabajo_id uuid,
  linea_operacional_id uuid,
  turno_habitual text check (turno_habitual is null or length(btrim(turno_habitual)) between 1 and 60),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'anonimizado')),
  fecha_desvinculacion date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, cedula),
  unique (id, empresa_id),
  foreign key (cargo_id, empresa_id) references cargos (id, empresa_id) on delete restrict,
  foreign key (area_id, empresa_id) references areas (id, empresa_id) on delete restrict,
  foreign key (centro_trabajo_id, empresa_id) references centros_trabajo (id, empresa_id) on delete restrict,
  foreign key (linea_operacional_id, empresa_id) references lineas_operacionales (id, empresa_id) on delete restrict
);

comment on table operadores is 'Operadores evaluados. Nunca se borran: pasan a inactivo o anonimizado (Fase 2 §0.6, Ley 1581).';

-- Fase 3 §14: índice de búsqueda por cédula (el unique ya lo cubre, se deja explícito por claridad de intención).
create index if not exists idx_operadores_empresa_cedula on operadores (empresa_id, cedula);
create index if not exists idx_operadores_empresa_estado on operadores (empresa_id, estado);
create index if not exists idx_operadores_usuario on operadores (usuario_id) where usuario_id is not null;

-- -----------------------------------------------------------------------------
-- Anonimización (Fase 2 §0.6 / Fase 3 §5)
-- -----------------------------------------------------------------------------
-- Cuando `estado` pasa a 'anonimizado' se elimina la identificación directa
-- conservando el `id`, para que las evaluaciones históricas sigan siendo
-- válidas en las curvas poblacionales sin identificar a la persona.
--
-- `cedula` es NOT NULL y única por empresa, por lo que no puede quedar vacía:
-- se reemplaza por un marcador derivado del id ('ANON-<uuid>'), único y sin
-- relación con la identidad real.
--
-- La operación es IRREVERSIBLE por diseño: un registro anonimizado no puede
-- volver a otro estado ni recuperar datos de identificación (si pudiera, la
-- anonimización no sería tal frente a un titular que ejerce su derecho).

create or replace function operadores_anonimizar()
returns trigger language plpgsql as $$
begin
  -- Un registro ya anonimizado queda congelado en su identidad y su estado.
  if old.estado = 'anonimizado' then
    if new.estado <> 'anonimizado' then
      raise exception 'Un operador anonimizado no puede volver a otro estado (operación irreversible).'
        using errcode = 'check_violation';
    end if;
    if new.cedula is distinct from old.cedula
       or new.nombre is distinct from old.nombre
       or new.apellido is distinct from old.apellido
       or new.usuario_id is distinct from old.usuario_id then
      raise exception 'Un operador anonimizado no admite datos de identificación.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.estado = 'anonimizado' then
    new.cedula := 'ANON-' || old.id::text;
    new.nombre := null;
    new.apellido := null;
    new.usuario_id := null;
    new.fecha_desvinculacion := coalesce(new.fecha_desvinculacion, current_date);
  end if;

  return new;
end;
$$;

comment on function operadores_anonimizar() is 'Anonimización irreversible de operadores (Ley 1581). Ver nota en la migración 0004.';

drop trigger if exists trg_operadores_anonimizar on operadores;
create trigger trg_operadores_anonimizar
  before update on operadores
  for each row execute function operadores_anonimizar();

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['areas', 'procesos', 'centros_trabajo', 'cargos', 'lineas_operacionales', 'operadores']
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on %1$s', v_tabla);
    execute format(
      'create trigger trg_%1$s_updated_at before update on %1$s for each row execute function set_updated_at()',
      v_tabla
    );
  end loop;
end $$;
