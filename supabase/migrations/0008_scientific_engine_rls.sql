-- =============================================================================
-- Migración: 0008_scientific_engine_rls.sql
-- Módulo 4 — Scientific Engine | RLS (Fase 3 §13)
-- =============================================================================
--  * Leer la configuración científica: quien evalúa (`evaluaciones.registrar`),
--    consulta (`evaluaciones.ver`) o configura (`configuracion.editar` /
--    `baremos.editar`). El operador necesita los pesos y el baremo para ver su
--    resultado al terminar la prueba (flujo de Fase 2 §4).
--  * Escribir pesos del ICO: `configuracion.editar`. Escribir baremos de la
--    empresa: `baremos.editar`. Baremos científicos globales (empresa_id nulo):
--    solo Super Administrador (Fase 3 §13).
--  * Cualquier usuario autenticado lee los baremos científicos globales.
--  * Sin política DELETE: las versiones nunca se borran.
-- =============================================================================

alter table ico_configuraciones enable row level security;
alter table baremos enable row level security;

drop policy if exists ico_configuraciones_select on ico_configuraciones;
create policy ico_configuraciones_select on ico_configuraciones for select
  using (
    tiene_permiso('evaluaciones.registrar', empresa_id)
    or tiene_permiso('evaluaciones.ver', empresa_id)
    or tiene_permiso('configuracion.editar', empresa_id)
    or es_super_administrador()
  );

drop policy if exists ico_configuraciones_insert on ico_configuraciones;
create policy ico_configuraciones_insert on ico_configuraciones for insert
  with check (tiene_permiso('configuracion.editar', empresa_id) or es_super_administrador());

drop policy if exists ico_configuraciones_update on ico_configuraciones;
create policy ico_configuraciones_update on ico_configuraciones for update
  using (tiene_permiso('configuracion.editar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('configuracion.editar', empresa_id) or es_super_administrador());

drop policy if exists baremos_select on baremos;
create policy baremos_select on baremos for select
  using (
    (empresa_id is null and auth.uid() is not null)
    or tiene_permiso('evaluaciones.registrar', empresa_id)
    or tiene_permiso('evaluaciones.ver', empresa_id)
    or tiene_permiso('baremos.editar', empresa_id)
    or es_super_administrador()
  );

drop policy if exists baremos_insert on baremos;
create policy baremos_insert on baremos for insert
  with check (
    (empresa_id is not null and tiene_permiso('baremos.editar', empresa_id))
    or es_super_administrador()
  );

drop policy if exists baremos_update on baremos;
create policy baremos_update on baremos for update
  using (
    (empresa_id is not null and tiene_permiso('baremos.editar', empresa_id))
    or es_super_administrador()
  )
  with check (
    (empresa_id is not null and tiene_permiso('baremos.editar', empresa_id))
    or es_super_administrador()
  );
