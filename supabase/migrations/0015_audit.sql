-- =============================================================================
-- Migración: 0015_audit.sql
-- Módulo 7 — Audit | Fase 3 §12
-- =============================================================================
-- `auditoria` es APPEND-ONLY: sin políticas de UPDATE/DELETE y, además, triggers
-- que rechazan UPDATE/DELETE/TRUNCATE incluso al dueño de la tabla o a un rol
-- con BYPASSRLS (ni siquiera el Super Administrador puede alterar el historial).
--
-- Se alimenta por:
--  * trigger `auditar_cambio` en las tablas sensibles de Fase 3 §12;
--  * `registrar_auditoria()` para acciones sin tabla propia (exportaciones, etc.).
--
-- Privacidad: para `operadores` el detalle excluye cédula, nombre, apellido y
-- cuenta (la auditoría no puede conservar lo que la anonimización elimina).
-- Idempotente.
-- =============================================================================

create table if not exists auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid,
  usuario_id uuid,   -- sin FK: un registro append-only no puede bloquear ni ser modificado por el borrado de un usuario
  accion text not null check (length(accion) between 3 and 80),
  entidad text not null check (length(entidad) between 1 and 80),
  entidad_id uuid,
  detalle_anterior jsonb,
  detalle_nuevo jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_auditoria_empresa_fecha on auditoria (empresa_id, created_at desc);
create index if not exists idx_auditoria_entidad on auditoria (entidad, entidad_id);

alter table auditoria enable row level security;
drop policy if exists auditoria_select on auditoria;
create policy auditoria_select on auditoria for select
  using ((empresa_id is not null and tiene_permiso('auditoria.ver', empresa_id)) or es_super_administrador());
-- Sin políticas de INSERT/UPDATE/DELETE para usuarios.

create or replace function auditoria_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'La auditoría es de solo anexado (append-only).' using errcode = 'insufficient_privilege';
end;
$$;
drop trigger if exists trg_auditoria_no_update on auditoria;
create trigger trg_auditoria_no_update before update or delete on auditoria for each row execute function auditoria_inmutable();
drop trigger if exists trg_auditoria_no_truncate on auditoria;
create trigger trg_auditoria_no_truncate before truncate on auditoria for each statement execute function auditoria_inmutable();

-- IP de origen tal como la informa el gateway (si no hay cabeceras, null).
create or replace function auditoria_ip()
returns text language plpgsql stable as $$
declare v text;
begin
  v := nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for';
  return left(split_part(coalesce(v, ''), ',', 1), 64);
exception when others then
  return null;
end;
$$;

create or replace function auditoria_usuario()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from usuarios where id = auth.uid()
$$;

-- Trigger genérico ------------------------------------------------------------
create or replace function auditar_cambio()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_ref jsonb := coalesce(v_new, v_old);
  v_pii text[] := array['cedula', 'nombre', 'apellido', 'usuario_id'];
begin
  if tg_table_name = 'operadores' then
    v_old := v_old - v_pii;
    v_new := v_new - v_pii;
  end if;
  -- Un UPDATE sin cambios reales (p. ej. updated_at) no genera ruido.
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, detalle_anterior, detalle_nuevo, ip)
  values (
    nullif(v_ref->>'empresa_id', '')::uuid,
    auditoria_usuario(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    nullif(coalesce(v_ref->>'id', v_ref->>'usuario_id', v_ref->>'empresa_id'), '')::uuid,
    v_old, v_new, auditoria_ip()
  );
  return coalesce(new, old);
end;
$$;

do $$
declare v_tabla text;
begin
  foreach v_tabla in array array['configuracion_empresa', 'ico_configuraciones', 'baremos', 'reglas', 'operadores', 'usuarios_roles']
  loop
    execute format('drop trigger if exists trg_auditar on %I', v_tabla);
    execute format('create trigger trg_auditar after insert or update or delete on %I for each row execute function auditar_cambio()', v_tabla);
  end loop;
end $$;

-- Acciones sin tabla propia ---------------------------------------------------
create or replace function registrar_auditoria(p_empresa uuid, p_accion text, p_entidad text, p_entidad_id uuid default null, p_detalle jsonb default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_empresa is null or not (p_empresa in (select empresas_del_usuario()) or es_super_administrador()) then
    raise exception 'registrar_auditoria: la empresa no pertenece al usuario.' using errcode = 'insufficient_privilege';
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, detalle_nuevo, ip)
  values (p_empresa, auditoria_usuario(), p_accion, p_entidad, p_entidad_id, p_detalle, auditoria_ip())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function registrar_auditoria(uuid, text, text, uuid, jsonb) from public;
grant execute on function registrar_auditoria(uuid, text, text, uuid, jsonb) to authenticated;
