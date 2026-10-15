-- =============================================================================
-- supabase/tests/local_stubs.sql
-- Simula, en un Postgres local SIN Supabase, los objetos que Supabase provee:
-- esquema `auth` (users, uid(), role()) y los roles `anon` / `authenticated`.
-- NO ejecutar en un proyecto Supabase real: ya los trae.
--
-- `auth.uid()` lee la variable de sesión `request.jwt.claim.sub`, igual que
-- hace PostgREST con el JWT de la petición.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

-- app_user representa a un usuario final de la API: hereda `authenticated`
-- (igual que lo hace Supabase) y NO es superusuario, así que RLS se evalúa.
grant authenticated to app_user;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select case when auth.uid() is null then 'anon' else 'authenticated' end
$$;

grant usage on schema auth to anon, authenticated;
grant select on auth.users to authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.role() to anon, authenticated;
