-- =============================================================================
-- Migración: 0002_identity_access_functions_rls.sql
-- Módulo 2 — Authentication | RLS (Fase 3 §13)
-- =============================================================================
-- Funciones helper `empresas_del_usuario()` y `tiene_permiso()` (Fase 3 §13)
-- + políticas RLS para cada tabla de Identity & Access. El patrón
-- `tiene_permiso('<dominio>.<accion>', empresa_id)` es el que los módulos
-- futuros replican en sus propias tablas.
--
-- Detalle que Fase 3 §13 dejó abierto: el rol "Super Administrador" (Fase 2
-- §5, "Todas las empresas") se resuelve con `es_super_administrador()`, que
-- verifica si el usuario tiene AL MENOS UNA fila en usuarios_roles apuntando
-- al rol plantilla 'Super Administrador', sin importar su empresa_id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones helper
-- -----------------------------------------------------------------------------
--
-- CRÍTICO — deben ser SECURITY DEFINER: `usuarios_roles`, `roles` y
-- `roles_permisos` tienen RLS activo, y esas mismas políticas invocan estas
-- funciones. Con SECURITY INVOKER (valor por defecto) heredarían el RLS del
-- llamador y dispararían las mismas políticas de nuevo: recursión infinita,
-- confirmada contra Postgres real ("stack depth limit exceeded").
-- SECURITY DEFINER ejecuta el cuerpo con los privilegios del creador (bypass
-- de RLS solo dentro de la función).
--
-- `set search_path = public, pg_temp` es obligatorio junto con SECURITY
-- DEFINER: evita el secuestro de resolución de nombres (search_path hijacking).

create or replace function empresas_del_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select empresa_id from usuarios_roles where usuario_id = auth.uid()
$$;

comment on function empresas_del_usuario() is 'Empresas a las que el usuario autenticado tiene alguna asignación de rol (Fase 3 §13). SECURITY DEFINER: ver nota arriba.';

revoke all on function empresas_del_usuario() from public;
grant execute on function empresas_del_usuario() to authenticated;

create or replace function tiene_permiso(permiso_codigo text, empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from usuarios_roles ur
    join roles_permisos rp on rp.role_id = ur.role_id
    join permisos p on p.id = rp.permiso_id
    where ur.usuario_id = auth.uid()
      and ur.empresa_id = empresa
      and p.codigo = permiso_codigo
  )
$$;

comment on function tiene_permiso(text, uuid) is 'Verifica si el usuario autenticado tiene un permiso específico en una empresa dada (Fase 3 §13). SECURITY DEFINER: ver nota arriba.';

revoke all on function tiene_permiso(text, uuid) from public;
grant execute on function tiene_permiso(text, uuid) to authenticated;

create or replace function es_super_administrador()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from usuarios_roles ur
    join roles r on r.id = ur.role_id
    where ur.usuario_id = auth.uid()
      and r.es_plantilla = true
      and r.nombre = 'Super Administrador'
  )
$$;

comment on function es_super_administrador() is 'Ver nota de implementación al inicio de este archivo. SECURITY DEFINER: ver nota arriba.';

revoke all on function es_super_administrador() from public;
grant execute on function es_super_administrador() to authenticated;

-- -----------------------------------------------------------------------------
-- empresas
-- -----------------------------------------------------------------------------

alter table empresas enable row level security;

drop policy if exists empresas_select on empresas;
create policy empresas_select on empresas for select
  using (id in (select empresas_del_usuario()) or es_super_administrador());

drop policy if exists empresas_insert on empresas;
create policy empresas_insert on empresas for insert
  with check (es_super_administrador());

drop policy if exists empresas_update on empresas;
create policy empresas_update on empresas for update
  using (es_super_administrador())
  with check (es_super_administrador());

-- -----------------------------------------------------------------------------
-- configuracion_empresa
-- -----------------------------------------------------------------------------

alter table configuracion_empresa enable row level security;

drop policy if exists configuracion_empresa_select on configuracion_empresa;
create policy configuracion_empresa_select on configuracion_empresa for select
  using (empresa_id in (select empresas_del_usuario()) or es_super_administrador());

drop policy if exists configuracion_empresa_update on configuracion_empresa;
create policy configuracion_empresa_update on configuracion_empresa for update
  using (tiene_permiso('configuracion.editar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('configuracion.editar', empresa_id) or es_super_administrador());

-- El insert ordinario ocurre vía trigger; no se habilita insert directo por RLS.

-- -----------------------------------------------------------------------------
-- permisos — catálogo global (Fase 3 §13, casos especiales)
-- -----------------------------------------------------------------------------

alter table permisos enable row level security;

drop policy if exists permisos_select on permisos;
create policy permisos_select on permisos for select
  using (auth.role() = 'authenticated');

drop policy if exists permisos_write on permisos;
create policy permisos_write on permisos for all
  using (es_super_administrador())
  with check (es_super_administrador());

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------

alter table roles enable row level security;

drop policy if exists roles_select on roles;
create policy roles_select on roles for select
  using (
    (es_plantilla and empresa_id is null and auth.role() = 'authenticated')
    or empresa_id in (select empresas_del_usuario())
    or es_super_administrador()
  );

drop policy if exists roles_insert on roles;
create policy roles_insert on roles for insert
  with check (
    (es_plantilla and empresa_id is null and es_super_administrador())
    or (not es_plantilla and empresa_id is not null and tiene_permiso('usuarios.administrar', empresa_id))
  );

drop policy if exists roles_update on roles;
create policy roles_update on roles for update
  using (
    (es_plantilla and empresa_id is null and es_super_administrador())
    or (empresa_id is not null and tiene_permiso('usuarios.administrar', empresa_id))
  )
  with check (
    (es_plantilla and empresa_id is null and es_super_administrador())
    or (empresa_id is not null and tiene_permiso('usuarios.administrar', empresa_id))
  );

-- -----------------------------------------------------------------------------
-- roles_permisos — visibilidad heredada de la del rol asociado
-- -----------------------------------------------------------------------------

alter table roles_permisos enable row level security;

drop policy if exists roles_permisos_select on roles_permisos;
create policy roles_permisos_select on roles_permisos for select
  using (
    exists (
      select 1 from roles r
      where r.id = roles_permisos.role_id
        and (
          (r.es_plantilla and r.empresa_id is null and auth.role() = 'authenticated')
          or r.empresa_id in (select empresas_del_usuario())
          or es_super_administrador()
        )
    )
  );

drop policy if exists roles_permisos_write on roles_permisos;
create policy roles_permisos_write on roles_permisos for all
  using (
    exists (
      select 1 from roles r
      where r.id = roles_permisos.role_id
        and (
          (r.es_plantilla and r.empresa_id is null and es_super_administrador())
          or (r.empresa_id is not null and tiene_permiso('usuarios.administrar', r.empresa_id))
        )
    )
  )
  with check (
    exists (
      select 1 from roles r
      where r.id = roles_permisos.role_id
        and (
          (r.es_plantilla and r.empresa_id is null and es_super_administrador())
          or (r.empresa_id is not null and tiene_permiso('usuarios.administrar', r.empresa_id))
        )
    )
  );

-- -----------------------------------------------------------------------------
-- usuarios — el propio usuario, o compañeros de empresa con permiso 'usuarios.ver'
-- -----------------------------------------------------------------------------

alter table usuarios enable row level security;

drop policy if exists usuarios_select on usuarios;
create policy usuarios_select on usuarios for select
  using (
    id = auth.uid()
    or es_super_administrador()
    or exists (
      select 1 from usuarios_roles ur
      where ur.usuario_id = usuarios.id
        and ur.empresa_id in (select empresas_del_usuario())
        and tiene_permiso('usuarios.ver', ur.empresa_id)
    )
  );

drop policy if exists usuarios_update_propio on usuarios;
create policy usuarios_update_propio on usuarios for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- El alta de usuarios (insert) ocurre vía función de servicio con rol
-- service_role al aceptar una invitación (admin/usuarios.js, Módulo 3).

-- -----------------------------------------------------------------------------
-- usuarios_roles
-- -----------------------------------------------------------------------------

alter table usuarios_roles enable row level security;

drop policy if exists usuarios_roles_select on usuarios_roles;
create policy usuarios_roles_select on usuarios_roles for select
  using (
    usuario_id = auth.uid()
    or es_super_administrador()
    or tiene_permiso('usuarios.ver', empresa_id)
  );

drop policy if exists usuarios_roles_write on usuarios_roles;
create policy usuarios_roles_write on usuarios_roles for all
  using (tiene_permiso('usuarios.administrar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('usuarios.administrar', empresa_id) or es_super_administrador());
