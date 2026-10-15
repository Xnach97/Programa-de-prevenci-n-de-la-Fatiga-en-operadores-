-- Papelera del panel del supervisor (ejecutar una sola vez en Supabase > SQL Editor)

-- 1) Columnas para el borrado lógico
ALTER TABLE evaluaciones
  ADD COLUMN IF NOT EXISTS eliminado_en   timestamptz,
  ADD COLUMN IF NOT EXISTS eliminado_tipo text;   -- 'resultado' o 'operador'

-- 2) Permiso para actualizar (enviar a la papelera y restaurar)
DROP POLICY IF EXISTS "evaluaciones_update" ON evaluaciones;
CREATE POLICY "evaluaciones_update" ON evaluaciones
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 3) Pruebas realizadas parcialmente: permitir vacíos en las pruebas no hechas
ALTER TABLE evaluaciones
  ALTER COLUMN p1_tiempo  DROP NOT NULL, ALTER COLUMN p1_errores DROP NOT NULL,
  ALTER COLUMN p2_tiempo  DROP NOT NULL, ALTER COLUMN p2_errores DROP NOT NULL,
  ALTER COLUMN p3_tiempo  DROP NOT NULL, ALTER COLUMN p3_errores DROP NOT NULL;

-- 4) Prueba 4 (laberinto), si aún no se agregó
ALTER TABLE evaluaciones
  ADD COLUMN IF NOT EXISTS p4_tiempo  integer,
  ADD COLUMN IF NOT EXISTS p4_errores integer;
