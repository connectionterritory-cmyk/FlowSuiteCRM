insert into public.agua_reglas (sistema, componente, intervalo_meses, aplica_si)
select v.sistema, v.componente, v.intervalo_meses, v.aplica_si
from (
  values
    ('FrescaFlow', 'Prefiltro', 6, null),
    ('FrescaFlow', 'Carbon', 12, null),
    ('FrescaFlow', 'Mineralizador', 12, null),
    ('FrescaFlow', 'RO', 24, null),
    ('FrescaPure 3000', 'Carbon', 12, null),
    ('FrescaPure 5500', 'Carbon', 12, null),
    ('FrescaPure 5500', 'Prefiltro', 6, 'si_aplica'),
    ('Ducha', 'Carbon', 6, null)
) as v(sistema, componente, intervalo_meses, aplica_si)
where not exists (
  select 1
  from public.agua_reglas r
  where r.sistema = v.sistema
    and r.componente = v.componente
    and r.intervalo_meses = v.intervalo_meses
    and coalesce(r.aplica_si, '') = coalesce(v.aplica_si, '')
);
