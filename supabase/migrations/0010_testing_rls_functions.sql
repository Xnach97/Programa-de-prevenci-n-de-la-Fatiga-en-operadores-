-- =============================================================================
-- Migración: 0010_testing_rls_functions.sql
-- Módulo 5 — Testing Engine | RLS y registro atómico e idempotente
-- =============================================================================
--  * Catálogo de pruebas: lectura para cualquier autenticado; escritura solo
--    Super Administrador (Fase 3 §13).
--  * Evaluaciones/resultados: leer con `evaluaciones.ver`, o el propio operador
--    (usuario_id = auth.uid(), Fase 3 §13); crear con `evaluaciones.registrar`;
--    marcar/descartar con `registros.eliminar`. Sin DELETE para nadie.
--  * `registrar_evaluacion(jsonb)`: inserta evaluación + resultados en UNA
--    transacción. Reenviar el mismo `evaluacion_id` (cola offline) no duplica.
--    El intento_numero y la clave de idempotencia los calcula el SERVIDOR; solo
--    el primer intento del día/turno/prueba es válido para análisis (decisión
--    0.3 de Fase 2: los repetidos se conservan marcados, no se descartan).
-- =============================================================================

create or replace function fecha_local(p_ts timestamptz)
returns date language sql immutable as $$
  -- Zona operativa de la plataforma (Colombia). Si se vendiera a empresas en
  -- otras zonas, esta función pasa a leer la zona de configuracion_empresa.
  select (p_ts at time zone 'America/Bogota')::date
$$;

alter table pruebas enable row level security;
alter table pruebas_versiones enable row level security;
alter table pruebas_referencias_bibliograficas enable row level security;
alter table evaluaciones enable row level security;
alter table resultados_pruebas enable row level security;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['pruebas', 'pruebas_versiones', 'pruebas_referencias_bibliograficas']
  loop
    execute format('drop policy if exists %1$I on %2$I', v_tabla || '_select', v_tabla);
    execute format('create policy %1$I on %2$I for select using (auth.uid() is not null)', v_tabla || '_select', v_tabla);
    execute format('drop policy if exists %1$I on %2$I', v_tabla || '_write', v_tabla);
    execute format('create policy %1$I on %2$I for all using (es_super_administrador()) with check (es_super_administrador())', v_tabla || '_write', v_tabla);
  end loop;
end $$;

drop policy if exists evaluaciones_select on evaluaciones;
create policy evaluaciones_select on evaluaciones for select
  using (
    tiene_permiso('evaluaciones.ver', empresa_id)
    or exists (select 1 from operadores o where o.id = evaluaciones.operador_id and o.usuario_id = auth.uid())
    or es_super_administrador()
  );

drop policy if exists evaluaciones_insert on evaluaciones;
create policy evaluaciones_insert on evaluaciones for insert
  with check (tiene_permiso('evaluaciones.registrar', empresa_id) or es_super_administrador());

drop policy if exists evaluaciones_update on evaluaciones;
create policy evaluaciones_update on evaluaciones for update
  using (tiene_permiso('registros.eliminar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('registros.eliminar', empresa_id) or es_super_administrador());

drop policy if exists resultados_select on resultados_pruebas;
create policy resultados_select on resultados_pruebas for select
  using (
    tiene_permiso('evaluaciones.ver', empresa_id)
    or exists (select 1 from operadores o where o.id = resultados_pruebas.operador_id and o.usuario_id = auth.uid())
    or es_super_administrador()
  );

drop policy if exists resultados_insert on resultados_pruebas;
create policy resultados_insert on resultados_pruebas for insert
  with check (tiene_permiso('evaluaciones.registrar', empresa_id) or es_super_administrador());

drop policy if exists resultados_update on resultados_pruebas;
create policy resultados_update on resultados_pruebas for update
  using (tiene_permiso('registros.eliminar', empresa_id) or es_super_administrador())
  with check (tiene_permiso('registros.eliminar', empresa_id) or es_super_administrador());

-- -----------------------------------------------------------------------------
-- Registro atómico e idempotente
-- -----------------------------------------------------------------------------
-- p = {
--   evaluacion_id, empresa_id, operador_id, turno, fecha, dispositivo_id,
--   ico_configuracion_id, baremo_snapshot_id, ico_valor, ico_nivel,
--   resultados: [{prueba_version_id, tiempo_total_ms, errores_totales,
--                 puntaje_normalizado, metricas}]
-- }
-- SECURITY INVOKER: corre con los permisos (y RLS) de quien llama.

create or replace function registrar_evaluacion(p jsonb)
returns jsonb language plpgsql as $$
declare
  v_id uuid := (p->>'evaluacion_id')::uuid;
  v_empresa uuid := (p->>'empresa_id')::uuid;
  v_operador uuid := (p->>'operador_id')::uuid;
  v_turno text := p->>'turno';
  v_fecha timestamptz := coalesce((p->>'fecha')::timestamptz, now());
  v_res jsonb;
  v_prueba uuid;
  v_intento int;
  v_filas int;
begin
  if v_id is null or v_empresa is null or v_operador is null or v_turno is null then
    raise exception 'registrar_evaluacion: faltan evaluacion_id, empresa_id, operador_id o turno.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p->'resultados') <> 'array' or jsonb_array_length(p->'resultados') = 0 then
    raise exception 'registrar_evaluacion: se requiere al menos un resultado.' using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotencia: la misma evaluación reenviada no se vuelve a insertar.
  insert into evaluaciones (id, empresa_id, operador_id, turno, fecha, dispositivo_id,
                            ico_configuracion_id, baremo_snapshot_id, ico_valor, ico_nivel)
  values (v_id, v_empresa, v_operador, v_turno, v_fecha, p->>'dispositivo_id',
          nullif(p->>'ico_configuracion_id', '')::uuid, nullif(p->>'baremo_snapshot_id', '')::uuid,
          (p->>'ico_valor')::numeric, nullif(p->>'ico_nivel', ''))
  on conflict (id) do nothing;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    -- Solo se reconoce como duplicada si ya existía para ESTA empresa.
    if not exists (select 1 from evaluaciones where id = v_id and empresa_id = v_empresa) then
      raise exception 'registrar_evaluacion: el identificador pertenece a otra empresa.' using errcode = 'insufficient_privilege';
    end if;
    return jsonb_build_object('evaluacion_id', v_id, 'duplicada', true);
  end if;

  for v_res in select * from jsonb_array_elements(p->'resultados') loop
    select prueba_id into v_prueba from pruebas_versiones where id = (v_res->>'prueba_version_id')::uuid;
    if v_prueba is null then
      raise exception 'registrar_evaluacion: versión de prueba inexistente.' using errcode = 'foreign_key_violation';
    end if;

    select count(*) + 1 into v_intento
      from resultados_pruebas r
      join pruebas_versiones pv on pv.id = r.prueba_version_id
     where r.operador_id = v_operador
       and pv.prueba_id = v_prueba
       and r.evaluacion_id <> v_id
       and fecha_local((select e.fecha from evaluaciones e where e.id = r.evaluacion_id)) = fecha_local(v_fecha)
       and (select e.turno from evaluaciones e where e.id = r.evaluacion_id) = v_turno;

    insert into resultados_pruebas (evaluacion_id, empresa_id, operador_id, prueba_version_id, intento_numero,
                                    clave_idempotencia, es_valido_para_analisis,
                                    tiempo_total_ms, errores_totales, puntaje_normalizado, metricas)
    values (v_id, v_empresa, v_operador, (v_res->>'prueba_version_id')::uuid, v_intento,
            concat_ws('|', v_operador, v_prueba, v_turno, fecha_local(v_fecha), v_intento),
            v_intento = 1,
            (v_res->>'tiempo_total_ms')::int, (v_res->>'errores_totales')::int,
            (v_res->>'puntaje_normalizado')::numeric, coalesce(v_res->'metricas', '{}'::jsonb));
  end loop;

  return jsonb_build_object('evaluacion_id', v_id, 'duplicada', false);
end;
$$;

revoke all on function registrar_evaluacion(jsonb) from public;
grant execute on function registrar_evaluacion(jsonb) to authenticated;
