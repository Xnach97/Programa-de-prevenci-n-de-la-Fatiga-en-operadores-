-- =============================================================================
-- Migración: 0016_rules_seed.sql
-- Módulo 7 — Rules Engine | Reglas y recomendaciones de plantilla GLOBAL
-- =============================================================================
-- ⚠ UMBRALES PROVISIONALES: los documentos no fijan umbrales de alerta. Estos
-- valores son un punto de partida para que cada empresa (con `configuracion.editar`)
-- cree sus propias reglas; deben ser validados por el responsable SST/científico.
--
-- Métricas disponibles en una condición (ver statistics/rules.js):
--   ico                       ICO de la evaluación
--   ico_trabajador,
--   indice_atencion,
--   indice_fatiga,
--   indice_riesgo             indicadores del operador en el día de la evaluación
--   <prueba>.tiempo|puntaje|errores   resultado de esa prueba en la evaluación
-- Placeholders del mensaje: {operador} {ico} {umbral} {turno} {fatiga} {atencion}
-- Idempotente.
-- =============================================================================

insert into reglas (empresa_id, nombre, condicion, severidad, mensaje_plantilla)
select null, v.nombre, v.condicion::jsonb, v.severidad, v.mensaje
from (values
  ('ICO crítico', '{"indicador":"ico","op":"<","valor":50}', 'roja',
   'ICO de {operador} en {ico}, por debajo de {umbral} (turno {turno}).'),
  ('ICO bajo', '{"and":[{"indicador":"ico","op":">=","valor":50},{"indicador":"ico","op":"<","valor":70}]}', 'amarilla',
   'ICO de {operador} en {ico}, por debajo de {umbral} (turno {turno}).'),
  ('Fatiga elevada', '{"indicador":"indice_fatiga","op":">=","valor":60}', 'naranja',
   'Índice de fatiga de {operador} en {fatiga} (umbral {umbral}) en el turno {turno}.'),
  ('Reacción lenta con ICO bajo', '{"and":[{"indicador":"reaccion_simple.tiempo","op":">","percentil":90},{"indicador":"ico","op":"<","valor":70}]}', 'naranja',
   'Tiempo de reacción de {operador} por encima del percentil 90 de la empresa con ICO {ico}.')
) as v(nombre, condicion, severidad, mensaje)
where not exists (select 1 from reglas r where r.empresa_id is null and r.nombre = v.nombre);

insert into recomendaciones_plantillas (empresa_id, codigo, titulo, texto, condicion_activacion)
select null, v.codigo, v.titulo, v.texto, v.condicion::jsonb
from (values
  ('pausa_activa', 'Pausa activa y revisión de la jornada',
   'Se sugiere una pausa activa y revisar la carga y los descansos de la jornada de {operador} antes de continuar tareas críticas.',
   '{"indicador":"indice_fatiga","op":">=","valor":60}'),
  ('repetir_evaluacion', 'Repetir la evaluación',
   'Se sugiere repetir la evaluación tras un descanso y comentar el resultado con el profesional PGR.',
   '{"indicador":"ico","op":"<","valor":50}'),
  ('seguimiento_atencion', 'Seguimiento de atención',
   'El índice de atención de {operador} es bajo ({atencion}); se sugiere seguimiento en las próximas evaluaciones.',
   '{"indicador":"indice_atencion","op":"<","valor":50}')
) as v(codigo, titulo, texto, condicion)
where not exists (select 1 from recomendaciones_plantillas p where p.empresa_id is null and p.codigo = v.codigo);
