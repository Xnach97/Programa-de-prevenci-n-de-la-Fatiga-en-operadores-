-- =============================================================================
-- Migración: 0013_indicators_seed.sql
-- Módulo 6 — Indicators | Definiciones de indicadores
-- =============================================================================
-- ⚠ FÓRMULAS PROVISIONALES: Fase 3 §8 nombra los indicadores pero no define sus
-- fórmulas. Estas son las que implementa `statistics/indicadores.js`; deben ser
-- validadas por el responsable científico antes de uso clínico/legal.
--
--  ico_*            media del ICO de las evaluaciones válidas del periodo
--                   (empresa/área/cargo: media de las medias por operador).
--  indice_atencion  media del puntaje de pruebas de categoría atención.
--  indice_fatiga    100 − media del puntaje de pruebas de atención y velocidad.
--  indice_riesgo    % de evaluaciones válidas con nivel «requiere_atencion»
--                   (empresa/área: media de los porcentajes por operador).
--  Evaluación válida = todos sus resultados son del primer intento del turno.
-- Idempotente.
-- =============================================================================

insert into indicadores_definiciones (codigo, nombre, ambito, formula_ref, descripcion) values
  ('ico_trabajador',        'ICO del trabajador',        'operador', 'ico_media',       'Media del ICO de las evaluaciones válidas del periodo.'),
  ('ico_area',              'ICO del área',              'area',     'ico_media_grupo', 'Media de los ICO de los operadores del área.'),
  ('ico_cargo',             'ICO del cargo',             'cargo',    'ico_media_grupo', 'Media de los ICO de los operadores del cargo.'),
  ('ico_empresa',           'ICO de la empresa',         'empresa',  'ico_media_grupo', 'Media de los ICO de los operadores de la empresa.'),
  ('indice_atencion',       'Índice de atención',        'operador', 'indice_atencion', 'Media del puntaje de las pruebas de atención.'),
  ('indice_fatiga',         'Índice de fatiga',          'operador', 'indice_fatiga',   '100 menos la media del puntaje de pruebas de atención y velocidad.'),
  ('indice_fatiga_empresa', 'Índice de fatiga de la empresa', 'empresa', 'media_grupo_fatiga', 'Media del índice de fatiga de los operadores.'),
  ('indice_riesgo',         'Índice de riesgo',          'operador', 'indice_riesgo',   'Porcentaje de evaluaciones válidas que requieren atención.'),
  ('indice_riesgo_area',    'Índice de riesgo del área', 'area',     'media_grupo_riesgo', 'Media del índice de riesgo de los operadores del área.'),
  ('indice_riesgo_empresa', 'Índice de riesgo de la empresa', 'empresa', 'media_grupo_riesgo', 'Media del índice de riesgo de los operadores.')
on conflict (codigo) do update
  set nombre = excluded.nombre, ambito = excluded.ambito, formula_ref = excluded.formula_ref, descripcion = excluded.descripcion;
