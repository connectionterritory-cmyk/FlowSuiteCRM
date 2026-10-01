-- ============================================================================
-- P0 SECURITY CHANGESET  --  PROPOSED ONLY. NOT EXECUTED. NOT A MIGRATION FILE.
-- Target project: rxiarmbosgivaplygqug (FlowSuiteCRM production)
-- Baseline (pre-change) normalized snapshot fingerprint: 7e62bb61fb2cf9bc08ecd0704d1340a4 (51 parts)
-- Send as ONE multi-statement query so PostgreSQL runs it as a single implicit transaction.
-- ============================================================================
set local lock_timeout = '3s';

-- P0-01 (A1)  close anon on the 11 owner-rights views (authenticated SELECT unchanged)
revoke all on table
  public.contactos_actividades, public.ocr_import_pendientes, public.productos_sin_costo,
  public.v_agenda_hoy, public.v_cargo_vuelta_resumen, public.v_cartera_operativa,
  public.v_cartera_telemercadeo, public.v_izzy_flow_rp_clientes_import_eligible,
  public.v_izzy_flow_rp_clientes_import_summary, public.v_ledger_saldos_reconstruidos,
  public.v_product_catalog
from anon;

-- P0-02 (A1)  remove the RLS-bypassing write path through the two auto-updatable owner-rights views
revoke insert, update, delete, truncate, references, trigger, maintain on table
  public.contactos_actividades, public.productos_sin_costo
from authenticated;

-- P0-03 (A2)  stg_ba_insurance_import: service_role/owner only
alter table public.stg_ba_insurance_import enable row level security;
revoke all on table public.stg_ba_insurance_import from anon, authenticated;

-- P0-04 (A3)  reclutamiento_prospectos: keep authenticated behaviour, remove anon
alter policy "reclutamiento_prospectos_dev_all" on public.reclutamiento_prospectos to authenticated;
revoke all on table public.reclutamiento_prospectos from anon;

-- P0-05 (A4)  bot_sessions: only the Edge worker (service_role) uses it
alter policy "bot_sessions_service_all" on public.bot_sessions to service_role;
revoke all on table public.bot_sessions from anon, authenticated;

-- P0-06 (A5)  contacto_actividades: remove anon only (authenticated policies untouched)
revoke all on table public.contacto_actividades from anon;

-- P0-07 (B1)  sensitive/internal RPCs: owner (postgres) and service_role keep EXECUTE
revoke all on function public.fn_claim_outbox_messages_for_n8n(integer)            from public, anon, authenticated;
revoke all on function public.fn_dispatch_campaign(uuid, integer)                   from public, anon, authenticated;
revoke all on function public.merge_cliente_rp(uuid, uuid)                          from public, anon, authenticated;
revoke all on function public.merge_prospecto_rp(uuid, uuid)                        from public, anon, authenticated;
revoke all on function public.cleanup_bot_sessions()                                from public, anon, authenticated;
revoke all on function public.fn_cob_get_invitacion_data(uuid)                      from public, anon, authenticated;
revoke all on function public.fn_cob_get_recibo_data(uuid)                          from public, anon, authenticated;
revoke all on function public.fn_cob_get_statement_data(uuid)                       from public, anon, authenticated;
revoke all on function public.fn_import_izzy_leads_from_flow_royal_prestige_clientes() from public, anon, authenticated;

-- P0-08 (B2)  internal-only: callers are SECURITY DEFINER functions owned by postgres
revoke all on function public.fn_cob_insert_contacto_actividad(uuid, text, uuid, text, text, text, jsonb, uuid, timestamp with time zone, text)
  from public, anon, authenticated, service_role;

-- P0-09 (C)  14 co-hosted izzy_* tables: RLS enabled + forced, no API-role privileges (service_role bypasses RLS)
alter table public.izzy_activity_rules enable row level security;
alter table public.izzy_agent_rank_history enable row level security;
alter table public.izzy_ambassadors enable row level security;
alter table public.izzy_carriers enable row level security;
alter table public.izzy_commission_rates enable row level security;
alter table public.izzy_commission_reserves enable row level security;
alter table public.izzy_compensation_audit_log enable row level security;
alter table public.izzy_compensation_plans enable row level security;
alter table public.izzy_compensation_promotions enable row level security;
alter table public.izzy_compensation_settings enable row level security;
alter table public.izzy_director_bonus_rates enable row level security;
alter table public.izzy_rank_levels enable row level security;
alter table public.izzy_rank_requirements enable row level security;
alter table public.izzy_service_categories enable row level security;
alter table public.izzy_activity_rules force row level security;
alter table public.izzy_agent_rank_history force row level security;
alter table public.izzy_ambassadors force row level security;
alter table public.izzy_carriers force row level security;
alter table public.izzy_commission_rates force row level security;
alter table public.izzy_commission_reserves force row level security;
alter table public.izzy_compensation_audit_log force row level security;
alter table public.izzy_compensation_plans force row level security;
alter table public.izzy_compensation_promotions force row level security;
alter table public.izzy_compensation_settings force row level security;
alter table public.izzy_director_bonus_rates force row level security;
alter table public.izzy_rank_levels force row level security;
alter table public.izzy_rank_requirements force row level security;
alter table public.izzy_service_categories force row level security;
revoke all on table
  public.izzy_activity_rules, public.izzy_agent_rank_history, public.izzy_ambassadors,
  public.izzy_carriers, public.izzy_commission_rates, public.izzy_commission_reserves,
  public.izzy_compensation_audit_log, public.izzy_compensation_plans, public.izzy_compensation_promotions,
  public.izzy_compensation_settings, public.izzy_director_bonus_rates, public.izzy_rank_levels,
  public.izzy_rank_requirements, public.izzy_service_categories
from anon, authenticated;
