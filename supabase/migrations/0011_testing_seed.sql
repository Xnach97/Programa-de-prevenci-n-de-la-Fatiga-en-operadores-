-- =============================================================================
-- Migración: 0011_testing_seed.sql
-- Módulo 5 — Testing Engine | Catálogo base de pruebas y permisos de operación
-- =============================================================================
-- Las 4 pruebas del legado como filas de catálogo (Fase 3 §6): agregar una
-- prueba nueva es insertar datos, no cambiar el esquema.
--
-- ⚠ CALIBRACIÓN PROVISIONAL: los parámetros de normalización (qué tiempo vale 0
-- y cuál vale 100) NO provienen de los documentos de Fase 1–3 ni del legado: son
-- valores de partida razonables y las versiones se siembran como
-- `experimental`. Deben validarse científicamente (p. ej. con ARL) y publicarse
-- como versión nueva (`validada`) antes de usarse en decisiones de aptitud.
--
-- Idempotente: no re-inserta pruebas ni versiones existentes.
-- =============================================================================

do $$
declare
  r record;
  v_prueba uuid;
  v_version uuid;
begin
  for r in
    select * from (values
      ('atencion_cancelacion', 'Atención selectiva — cancelación de símbolos', 'atencion',
       'Marcar todos los símbolos iguales al objetivo en una cuadrícula.',
       'compuesta_tiempo_errores',
       '{"celdas":42,"minimo_objetivos":8,"simbolos":["★","●","▲","■","◆","▼","◀","▶","♦","⬟"],"tiempo_mejor_ms":30000,"tiempo_peor_ms":180000,"errores_maximo":10,"peso_tiempo":0.5}'::jsonb),
      ('stroop_adaptado', 'Stroop adaptado', 'inhibicion',
       'Indicar el color de la tinta de una palabra que nombra otro color.',
       'compuesta_tiempo_errores',
       '{"items":12,"retardo_feedback_ms":650,"tiempo_mejor_ms":20000,"tiempo_peor_ms":70000,"errores_maximo":6,"peso_tiempo":0.5}'::jsonb),
      ('memoria_secuencias', 'Memoria de secuencias', 'memoria',
       'Repetir secuencias de longitud creciente.',
       'lineal_mayor_mejor',
       '{"rondas":6,"elementos":6,"minimo":0,"maximo":6}'::jsonb),
      ('reaccion_simple', 'Tiempo de reacción simple', 'velocidad',
       'Responder lo más rápido posible al estímulo; la anticipación cuenta como error.',
       'compuesta_tiempo_errores',
       '{"ensayos":10,"espera_min_ms":1500,"espera_max_ms":4500,"tiempo_mejor_ms":200,"tiempo_peor_ms":500,"errores_maximo":5,"peso_tiempo":0.7}'::jsonb)
    ) as t(codigo, nombre, categoria, descripcion, funcion, parametros)
  loop
    insert into pruebas (codigo, nombre, categoria, descripcion)
    values (r.codigo, r.nombre, r.categoria, r.descripcion)
    on conflict (codigo) do nothing;

    select id into v_prueba from pruebas where codigo = r.codigo;

    if not exists (select 1 from pruebas_versiones where prueba_id = v_prueba) then
      insert into pruebas_versiones (prueba_id, numero_version, autor, estado, descripcion_cientifica, parametros, funcion_puntuacion)
      values (v_prueba, 1, 'NeuroLab SST (migración legado)', 'experimental',
              'Versión inicial migrada del legado (v7.2). Parámetros de normalización provisionales: pendientes de validación.',
              r.parametros, r.funcion)
      returning id into v_version;
      update pruebas set version_actual_id = v_version where id = v_prueba;
    end if;
  end loop;
end $$;

-- Quien opera la evaluación en el quiosco (supervisor / administrador) también
-- puede registrarla a nombre de un operador sin cuenta propia (modo kiosco).
insert into roles_permisos (role_id, permiso_id)
select r.id, p.id
from roles r
cross join permisos p
where r.es_plantilla and r.empresa_id is null
  and r.nombre in ('Supervisor SST', 'Administrador de empresa')
  and p.codigo = 'evaluaciones.registrar'
on conflict (role_id, permiso_id) do nothing;
