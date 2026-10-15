-- =============================================================================
-- Migración: 0017_dashboard_indicators.sql
-- Módulo 8 — Dashboard | Indicadores del radar cognitivo (Fase 2 §2: radar.js)
-- =============================================================================
-- El radar muestra una media por categoría de prueba (atención, memoria,
-- velocidad, inhibición). `indice_atencion` ya existe (0013); aquí se añaden
-- las tres restantes. Fórmula provisional: media del puntaje (0–100) de las
-- pruebas de la categoría en evaluaciones válidas.
-- Idempotente.
-- =============================================================================

insert into indicadores_definiciones (codigo, nombre, ambito, formula_ref, descripcion) values
  ('indice_memoria',    'Índice de memoria',    'operador', 'indice_categoria', 'Media del puntaje de las pruebas de memoria.'),
  ('indice_velocidad',  'Índice de velocidad',  'operador', 'indice_categoria', 'Media del puntaje de las pruebas de velocidad.'),
  ('indice_inhibicion', 'Índice de inhibición', 'operador', 'indice_categoria', 'Media del puntaje de las pruebas de inhibición.')
on conflict (codigo) do update
  set nombre = excluded.nombre, ambito = excluded.ambito, formula_ref = excluded.formula_ref, descripcion = excluded.descripcion;
