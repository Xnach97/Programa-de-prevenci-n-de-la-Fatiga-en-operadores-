-- =============================================================================
-- Migración: 0001_identity_access_schema.sql
-- Módulo 2 — Authentication | Dominio DDD: Identity & Access (Fase 3 §1, §3, §4)
-- =============================================================================
-- Crea el esquema de tablas para empresas, RBAC granular (permisos/roles) y
-- usuarios. Es la base sobre la que se apoya toda política RLS del sistema
-- (empresa_id + tiene_permiso()), definida en la migración 0002.
--
-- Convenciones (Fase 3 §2): PK uuid con gen_random_uuid(), empresa_id en toda
-- tabla operativa, estado en vez de DELETE físico, created_at/updated_at.
-- Idempotente: seguro de ejecutar más de una vez sobre el mismo esquema.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Empresas y su configuración (Fase 3 §4)
-- -----------------------------------------------------------------------------

create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nit text unique not null,
  plan text not null default 'standard' check (plan in ('trial', 'standard', 'enterprise')),
  estado text not null default 'activo' check (estado in ('activo', 'suspendido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table empresas is 'Tenant raíz de la plataforma. Toda tabla operativa referencia empresa_id (Fase 3 §2).';

create table if not exists configuracion_empresa (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  -- {logo_url, color_primario, color_secundario, color_acento, tipografia_display, tipografia_base}
  marca jsonb not null default '{}'::jsonb,
  -- [{"nombre":"Diurno","hora_inicio":"06:00","hora_fin":"18:00"}, ...]
  turnos jsonb not null default '[]'::jsonb,
  -- ids de /pruebas activas y su orden — poblado en Módulo Testing Engine
  pruebas_activas jsonb not null default '[]'::jsonb,
  -- {"dashboard_cientifico": true, "biometria": false, ...}
  feature_flags jsonb not null default '{}'::jsonb,
  baremo_modalidad text not null default 'dinamico'
    check (baremo_modalidad in ('dinamico', 'institucional', 'cientifico')),
  updated_at timestamptz not null default now(),
  updated_by uuid -- FK diferida a usuarios(id); se añade luego de crear la tabla usuarios en esta misma migración.
);

comment on table configuracion_empresa is 'Configuración de negocio por empresa (Fase 2 §1 principio 2: configuración sobre código). Editada desde admin/configuracion.js (Módulo Organization).';

-- -----------------------------------------------------------------------------
-- RBAC granular (Fase 3 §3): permisos como átomos, roles como conjuntos.
-- -----------------------------------------------------------------------------

create table if not exists permisos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null, -- 'evaluaciones.ver', 'usuarios.administrar', etc.
  descripcion text not null,
  dominio text not null -- agrupador visual en el panel admin
);

comment on table permisos is 'Catálogo global de permisos atómicos. Solo Super Administrador escribe (Fase 3 §13, casos especiales).';

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade, -- null = plantilla global
  nombre text not null,
  es_plantilla boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table roles is 'Roles de plantilla (empresa_id null) clonables por empresa (Fase 3 §3).';

-- Necesaria para ON CONFLICT idempotente al sembrar los 5 roles de plantilla (Fase 2 §5).
create unique index if not exists roles_plantilla_nombre_uk
  on roles (nombre)
  where es_plantilla and empresa_id is null;

create table if not exists roles_permisos (
  role_id uuid not null references roles(id) on delete cascade,
  permiso_id uuid not null references permisos(id) on delete cascade,
  primary key (role_id, permiso_id)
);

-- -----------------------------------------------------------------------------
-- Usuarios — 1:1 con Supabase Auth (Fase 3 §3)
-- -----------------------------------------------------------------------------

create table if not exists usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid references empresas(id), -- empresa "home"; acceso multi-empresa vía usuarios_roles
  nombre_completo text not null,
  email text not null,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table usuarios is 'Perfil de aplicación 1:1 con auth.users. auth.js es la única puerta de entrada que lo consulta (Fase 2 §3).';

-- FK diferida de configuracion_empresa.updated_by, ahora que usuarios ya existe.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'configuracion_empresa_updated_by_fkey'
  ) then
    alter table configuracion_empresa
      add constraint configuracion_empresa_updated_by_fkey
      foreign key (updated_by) references usuarios(id);
  end if;
end $$;

create table if not exists usuarios_roles (
  usuario_id uuid not null references usuarios(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade, -- redundante intencional (Fase 3 §3)
  created_at timestamptz not null default now(),
  primary key (usuario_id, role_id, empresa_id)
);

comment on table usuarios_roles is 'Asignación de rol de un usuario dentro de una empresa específica. Un usuario puede tener filas en varias empresas.';

-- -----------------------------------------------------------------------------
-- Índices de soporte para la resolución de sesión (auth.js) y RLS.
-- -----------------------------------------------------------------------------

create index if not exists idx_usuarios_roles_usuario on usuarios_roles (usuario_id);
create index if not exists idx_usuarios_roles_empresa on usuarios_roles (empresa_id);
create index if not exists idx_roles_permisos_role on roles_permisos (role_id);
create index if not exists idx_roles_empresa on roles (empresa_id);
create index if not exists idx_usuarios_empresa on usuarios (empresa_id);

-- -----------------------------------------------------------------------------
-- Trigger: toda empresa nueva recibe una fila de configuración por defecto.
-- -----------------------------------------------------------------------------

create or replace function crear_configuracion_empresa_por_defecto()
returns trigger language plpgsql as $$
begin
  insert into configuracion_empresa (empresa_id)
  values (new.id)
  on conflict (empresa_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_crear_configuracion_empresa on empresas;
create trigger trg_crear_configuracion_empresa
  after insert on empresas
  for each row execute function crear_configuracion_empresa_por_defecto();
