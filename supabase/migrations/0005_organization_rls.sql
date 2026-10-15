-- =============================================================================
-- Migración: 0005_organization_rls.sql
-- Módulo 3 — Organization | RLS (Fase 3 §13)
-- =============================================================================
-- Patrón de Fase 3 §13: `tiene_permiso('<dominio>.<accion>', empresa_id)`.
--
--  * Catálogos: leer exige `catalogos.ver`; crear/editar/borrar exige
--    `catalogos.editar`. El DELETE existe pero la FK ON DELETE RESTRICT impide
--    borrar un catálogo en uso (solo puede desactivarse, Fase 3 §5).
--  * Operadores: leer exige `operadores.ver`, más el caso especial de Fase 3
--    §13 (el propio operador con cuenta ve su fila: `usuario_id = auth.uid()`).
--    Crear/editar exige `operadores.administrar`. NO existe política de DELETE:
--    un operador nunca se borra, se inactiva o se anonimiza (Fase 2 §0.6).
--  * El Super Administrador conserva acceso transversal (misma convención que
--    el Módulo 2).
--
-- Cada política usa `with check` en insert/update, de modo que nadie puede
-- crear ni mover filas hacia una empresa donde no tiene permiso.
-- =============================================================================

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['areas', 'procesos', 'centros_trabajo', 'cargos', 'lineas_operacionales']
  loop
    execute format('alter table %I enable row level security', v_tabla);

    execute format('drop policy if exists %1$I on %2$I', v_tabla || '_select', v_tabla);
    execute format(
      'create policy %1$I on %2$I for select using (tiene_permiso(%3$L, empresa_id) or es_super_administrador())',
      v_tabla || '_select', v_tabla, 'catalogos.ver'
    );

    execute format('drop policy if exists %1$I on %2$I', v_tabla || '_insert', v_tabla);
    execute format(
      'create policy %1$I on %2$I for insert with check (tiene_permiso(%3$L, empresa_id) or es_super_administrador())',
      v_tabla || '_insert', v_tabla, 'catalogos.editar'
    );

    execute format('drop policy if exists %1$I on %2$I', v_tabla || '_update', v_tabla);
    execute format(
      'create policy %1$I on %2$I for update using (tiene_permiso(%3$L, empresa_id) or es_super_administrador()) with check (tiene_permiso(%3$L, empresa_id) or es_super_administrador())',
      v_tabla || '_update', v_tabla, 'catalogos.editar'
    );

    execute format('drop policy if exists %1$I on %2$I', v_tabla || '_delete', v_tabla);
    execute format(
      'create policy %1$I on %2$I for delete using (tiene_permiso(%3$L, empresa_id) or es_super_administrador())',
      v_tabla || '_delete', v_tabla, 'catalogos.editar'
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- operadores
-- -----------------------------------------------------------------------------

alter table operadores enable row level security;

drop policy if exists operadores_select on operadores;
create policy operadores_select on operadores for select
  using (
    tiene_permiso('operadores.ver', empresa_id)
    or usuario_id = auth.uid()
    or es_super_administrador()
  );

drop policy if exists operadores_insert on operadores;
create policy operadores_insert on operadores for insert
  with check (tiene_permiso('operadores.administrar', empresa_id) or es_super_administrador());

drop policy if exists operadores_update on operadores;
create policy operadores_update on operadores for update
  using (tiene_permiso('operadores.administrar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('operadores.administrar', empresa_id) or es_super_administrador());

-- Sin política de DELETE: RLS deniega por defecto. Los operadores no se borran.
