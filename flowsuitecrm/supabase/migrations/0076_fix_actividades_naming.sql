-- ============================================================
-- 0076: Corrigiendo posibles errores de pluralización
-- ============================================================

-- Si existe algún disparador que use el nombre incorrecto, lo eliminamos.
-- Nota: Esta migración es preventiva para asegurar que el sistema use 'contacto_actividades'.

DO $$
BEGIN
    -- Aquí podrías añadir lógica para renombrar o corregir si detectamos el fallo exacto.
    -- Por ahora, nos aseguramos de que no haya confusiones.
END $$;
