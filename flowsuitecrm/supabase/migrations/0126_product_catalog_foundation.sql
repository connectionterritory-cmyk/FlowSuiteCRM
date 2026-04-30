-- Migración 0126: Catálogo de Productos para Vendedor
-- ============================================================================
-- Extiende la tabla productos con columnas de catálogo y crea views/policies
-- Ejecutar en Supabase SQL Editor
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --------------------------------------------------------------------------
-- 1. Extender tabla productos con columnas de catálogo
-- --------------------------------------------------------------------------
-- Columnas regulares primero (buscable_text va en DO block separado porque
-- ADD COLUMN IF NOT EXISTS no admite GENERATED ALWAYS AS en todos los parsers)
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS estado             text          DEFAULT 'activo'
                                              CHECK (estado IN ('activo', 'borrador', 'descontinuado', 'reemplazado')),
  ADD COLUMN IF NOT EXISTS descripcion_corta  text,
  ADD COLUMN IF NOT EXISTS descripcion_larga  text,
  ADD COLUMN IF NOT EXISTS beneficios         text[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags               text[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reemplazado_por_id uuid          REFERENCES public.productos(id);

-- buscable_text como columna generada (requiere PG 12+; Supabase usa PG 15)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'productos'
      AND column_name  = 'buscable_text'
  ) THEN
    ALTER TABLE public.productos
      ADD COLUMN buscable_text tsvector GENERATED ALWAYS AS (
        to_tsvector('spanish',
          COALESCE(nombre,        '') || ' ' ||
          COALESCE(codigo,        '') || ' ' ||
          COALESCE(subcategoria,  '') || ' ' ||
          COALESCE(linea_producto,'') || ' ' ||
          COALESCE(array_to_string(tags, ' '), '')
        )
      ) STORED;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 2. Tabla de categorías de productos (global, sin org_id)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  descripcion text,
  orden       integer     DEFAULT 0,
  activo      boolean     DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- --------------------------------------------------------------------------
-- 3. Tabla de imágenes de productos (galería)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_images (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  es_principal boolean    DEFAULT false,
  orden       integer     DEFAULT 0,
  alt_text    text,
  created_at  timestamptz DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas faltantes en instalaciones
-- donde product_images ya fue creada por migraciones anteriores.
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS es_principal boolean NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- 4. Tabla de planes de pago (cuotas por plazo)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_payment_plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  plazo_meses integer     NOT NULL CHECK (plazo_meses > 0),
  cuota       numeric(12,2) NOT NULL CHECK (cuota > 0),
  tasa        numeric(6,4),
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (product_id, plazo_meses)
);

ALTER TABLE public.product_payment_plans
  ADD COLUMN IF NOT EXISTS tasa numeric(6,4);

-- --------------------------------------------------------------------------
-- 5. Tabla de historial de precios (append-only)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_price_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid        NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  precio         numeric(12,2) NOT NULL,
  precio_anterior numeric(12,2),
  motivo         text,
  efectivo_desde date        NOT NULL DEFAULT current_date,
  created_at     timestamptz DEFAULT now(),
  created_by     uuid        REFERENCES auth.users(id)
);

-- --------------------------------------------------------------------------
-- 6. Índices
-- --------------------------------------------------------------------------

-- tsvector usa GIN sin operator class (gin_trgm_ops es para text, no tsvector)
CREATE INDEX IF NOT EXISTS idx_productos_buscable_gin
  ON public.productos USING gin (buscable_text);

-- Trigrama en codigo y nombre para búsqueda parcial con ilike
CREATE INDEX IF NOT EXISTS idx_productos_codigo_trgm
  ON public.productos USING gin (codigo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm
  ON public.productos USING gin (nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_estado
  ON public.productos (estado) WHERE estado IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_categories_slug
  ON public.product_categories(slug);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id
  ON public.product_images(product_id);

CREATE INDEX IF NOT EXISTS idx_product_images_principal
  ON public.product_images(product_id, es_principal) WHERE es_principal = true;

CREATE INDEX IF NOT EXISTS idx_product_payment_plans_product_id
  ON public.product_payment_plans(product_id) WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_product_price_history_product_id
  ON public.product_price_history(product_id);

-- --------------------------------------------------------------------------
-- 7. View para vendedores (v_catalogo_vendedor)
--    - Solo authenticated (Fase 1, NO anon)
--    - cuota_minima desde product_payment_plans (no fórmula inventada)
--    - con_financiamiento derivado de existencia de planes activos
-- --------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_catalogo_vendedor;

CREATE VIEW public.v_catalogo_vendedor
  WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.codigo,
  p.nombre,
  p.categoria,
  p.categoria_principal,
  p.subcategoria,
  p.linea_producto,
  p.precio           AS precio_publico,
  p.foto_url         AS foto_principal_url,
  p.activo,
  p.estado,
  p.descripcion_corta,
  p.descripcion_larga,
  p.beneficios,
  p.tags,
  p.reemplazado_por_id,
  pr.codigo          AS reemplazado_por_codigo,
  pr.nombre          AS reemplazado_por_nombre,
  -- Foto desde galería si existe (fallback a foto_url ya cubierto por foto_principal_url)
  (
    SELECT url FROM public.product_images
    WHERE product_id = p.id AND es_principal = true
    LIMIT 1
  )                  AS foto_galeria_url,
  -- cuota_minima desde planes reales, no fórmula
  (
    SELECT min(pp.cuota)
    FROM public.product_payment_plans pp
    WHERE pp.product_id = p.id AND pp.activo = true
  )                  AS cuota_minima,
  -- con_financiamiento: true solo si existen planes activos
  EXISTS (
    SELECT 1 FROM public.product_payment_plans pp
    WHERE pp.product_id = p.id AND pp.activo = true
  )                  AS con_financiamiento,
  p.buscable_text
FROM public.productos p
LEFT JOIN public.productos pr ON p.reemplazado_por_id = pr.id
WHERE p.estado != 'borrador'
  AND p.activo = true;

-- Solo authenticated — Fase 1 no expone acceso anónimo
GRANT SELECT ON public.v_catalogo_vendedor TO authenticated;

-- --------------------------------------------------------------------------
-- 8. RLS en tablas nuevas
-- --------------------------------------------------------------------------
ALTER TABLE public.product_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_payment_plans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_history  ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado
DROP POLICY IF EXISTS product_categories_read    ON public.product_categories;
DROP POLICY IF EXISTS product_images_read        ON public.product_images;
DROP POLICY IF EXISTS product_payment_plans_read ON public.product_payment_plans;
DROP POLICY IF EXISTS product_price_history_read ON public.product_price_history;

CREATE POLICY product_categories_read ON public.product_categories
  FOR SELECT TO authenticated USING (activo = true);

CREATE POLICY product_images_read ON public.product_images
  FOR SELECT TO authenticated USING (true);

CREATE POLICY product_payment_plans_read ON public.product_payment_plans
  FOR SELECT TO authenticated USING (true);

-- Historial: solo admin/distribuidor
CREATE POLICY product_price_history_read ON public.product_price_history
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_distribuidor());

-- Escritura: solo admin/distribuidor en todas las tablas nuevas
DROP POLICY IF EXISTS product_categories_write    ON public.product_categories;
DROP POLICY IF EXISTS product_images_write        ON public.product_images;
DROP POLICY IF EXISTS product_payment_plans_write ON public.product_payment_plans;
DROP POLICY IF EXISTS product_price_history_insert ON public.product_price_history;

CREATE POLICY product_categories_write ON public.product_categories
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_distribuidor())
  WITH CHECK (public.is_admin() OR public.is_distribuidor());

CREATE POLICY product_images_write ON public.product_images
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_distribuidor())
  WITH CHECK (public.is_admin() OR public.is_distribuidor());

CREATE POLICY product_payment_plans_write ON public.product_payment_plans
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_distribuidor())
  WITH CHECK (public.is_admin() OR public.is_distribuidor());

-- Historial append-only: solo insert para admin/distribuidor
CREATE POLICY product_price_history_insert ON public.product_price_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_distribuidor());

-- --------------------------------------------------------------------------
-- 9. Grants de tablas de soporte
-- --------------------------------------------------------------------------
GRANT SELECT ON public.product_categories    TO authenticated;
GRANT SELECT ON public.product_images        TO authenticated;
GRANT SELECT ON public.product_payment_plans TO authenticated;

-- --------------------------------------------------------------------------
-- 10. Función set_updated_at (idempotente — puede ya existir)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_product_categories_updated_at ON public.product_categories;
CREATE TRIGGER update_product_categories_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 11. Trigger: sincronizar foto_url desde product_images (es_principal = true)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_product_main_photo()
RETURNS TRIGGER AS $$
DECLARE
  main_photo_url text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT url INTO main_photo_url
    FROM public.product_images
    WHERE product_id = OLD.product_id AND es_principal = true
    ORDER BY orden LIMIT 1;
    UPDATE public.productos SET foto_url = main_photo_url WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;

  IF NEW.es_principal = true THEN
    UPDATE public.productos SET foto_url = NEW.url WHERE id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_product_main_photo_trigger ON public.product_images;
CREATE TRIGGER sync_product_main_photo_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_main_photo();

-- --------------------------------------------------------------------------
-- Fin del bloque principal
-- --------------------------------------------------------------------------
COMMIT;


-- --------------------------------------------------------------------------
-- SEED: Datos de ejemplo (descomentar para ejecutar)
-- --------------------------------------------------------------------------
/*
BEGIN;

INSERT INTO public.product_categories (nombre, slug, descripcion, orden) VALUES
  ('Purificadores de Aire', 'purificadores-aire', 'Sistemas de purificación de aire para hogar', 1),
  ('Filtros de Agua',       'filtros-agua',       'Sistemas de filtración de agua',               2),
  ('Suavizadores',          'suavizadores',       'Suavizadores de agua',                         3),
  ('Multipanas',            'multipanas',         'Cocción saludable',                             4),
  ('Accesorios',            'accesorios',         'Refacciones y accesorios',                     5)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.productos (codigo, nombre, categoria, linea_producto, precio, estado, descripcion_corta) VALUES
  ('FP3000', 'FrescaPure 3000', 'purificadores', 'purificador_aire', 1299, 'activo',      'Purificador de aire con HEPA'),
  ('FP5500', 'FrescaPure 5500', 'purificadores', 'purificador_aire', 2199, 'activo',      'Purificador silencioso'),
  ('FP2000', 'FrescaPure 2000', 'purificadores', 'purificador_aire',  899, 'reemplazado', 'Modelo anterior'),
  ('FA1000', 'AquaPure 1000',   'filtros',       'filtro_agua',       599, 'activo',      'Filtro de agua básico'),
  ('SA500',  'SoftWater 500',   'suavizadores',  'suavizador',       2499, 'activo',      'Suavizador automático')
ON CONFLICT (codigo) DO NOTHING;

UPDATE public.productos
SET reemplazado_por_id = (SELECT id FROM public.productos WHERE codigo = 'FP3000')
WHERE codigo = 'FP2000';

INSERT INTO public.product_images (product_id, url, es_principal, orden)
SELECT id, 'https://placehold.co/400x400?text=' || codigo, true, 0
FROM public.productos
WHERE codigo IN ('FP3000', 'FP5500', 'FP2000', 'FA1000', 'SA500')
ON CONFLICT DO NOTHING;

INSERT INTO public.product_payment_plans (product_id, plazo_meses, cuota)
SELECT id, 12,  round(precio * 1.10 / 12, 2)  FROM public.productos WHERE codigo = 'FP3000'
UNION ALL
SELECT id, 24,  round(precio * 1.15 / 24, 2)  FROM public.productos WHERE codigo = 'FP3000'
UNION ALL
SELECT id, 36,  round(precio * 1.20 / 36, 2)  FROM public.productos WHERE codigo = 'FP3000'
UNION ALL
SELECT id, 24,  round(precio * 1.15 / 24, 2)  FROM public.productos WHERE codigo = 'FP5500'
UNION ALL
SELECT id, 36,  round(precio * 1.20 / 36, 2)  FROM public.productos WHERE codigo = 'FP5500'
ON CONFLICT (product_id, plazo_meses) DO NOTHING;

INSERT INTO public.product_price_history (product_id, precio, motivo, efectivo_desde)
SELECT id, precio, 'Precio inicial', '2024-01-01'
FROM public.productos
WHERE codigo IN ('FP3000', 'FP5500', 'FA1000', 'SA500');

COMMIT;
*/
