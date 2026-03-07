ALTER TABLE public.citas
  ADD COLUMN resultado text CHECK (resultado IN (
    'realizada',
    'venta',
    'no_contacto',
    'reagendar',
    'no_interes',
    'otro'
  )),
  ADD COLUMN resultado_notas text;
