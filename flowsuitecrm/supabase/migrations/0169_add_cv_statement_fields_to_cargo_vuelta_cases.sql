alter table public.cargo_vuelta_cases
  add column if not exists cv_approval_date date,
  add column if not exists cv_due_date date,
  add column if not exists cv_statement_date date,
  add column if not exists cv_interest_apr numeric(7,4),
  add column if not exists cv_statement_schedule_status text,
  add column if not exists cv_statement_generated_at timestamptz,
  add column if not exists cv_statement_last_resumen_id uuid;

comment on column public.cargo_vuelta_cases.cv_approval_date is
  'Approval date used for cargo vuelta statement calculations.';

comment on column public.cargo_vuelta_cases.cv_due_date is
  'Due date used for cargo vuelta statement calculations.';

comment on column public.cargo_vuelta_cases.cv_statement_date is
  'Statement date used for cargo vuelta statement calculations.';

comment on column public.cargo_vuelta_cases.cv_interest_apr is
  'Annual percentage rate used for projected cargo vuelta interest.';

comment on column public.cargo_vuelta_cases.cv_statement_schedule_status is
  'Schedule/status marker for cargo vuelta statement generation.';

comment on column public.cargo_vuelta_cases.cv_statement_generated_at is
  'Timestamp of the latest generated cargo vuelta statement.';

comment on column public.cargo_vuelta_cases.cv_statement_last_resumen_id is
  'Reference id of the latest cargo vuelta statement/resumen, if available.';
