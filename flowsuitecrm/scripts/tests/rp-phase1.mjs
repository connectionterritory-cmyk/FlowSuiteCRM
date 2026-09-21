// Run with Node >=20. Install @electric-sql/pglite in a temporary directory and
// pass PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite/dist/index.js.
// Uses an isolated in-memory Postgres instance; never connects to Supabase.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
const file = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
let checks = 0
const eq = (a, b) => { assert.deepEqual(a, b); checks++ }
const fail = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++ }
const q = async (sql, args = []) => (await db.query(sql, args)).rows
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const actor = async (n) => {
  await db.exec('RESET ROLE')
  await q("SELECT set_config('request.jwt.claim.sub', $1, false)", [n ? id(n) : ''])
  await db.exec('SET ROLE authenticated')
}
const create = async (lead, extra = {}) => (await q('SELECT public.fn_crear_venta_completa($1::jsonb) result', [JSON.stringify({
  owner_type: 'lead', lead_id: id(lead), vendedor_id: id(2), tipo_movimiento: 'venta_inicial',
  fecha_venta: '2026-09-20', estado: 'borrador', subtotal: 100, impuesto: 10,
  cargo_envio: 5, descuento: 2, pago_inicial: 20, total: 113, saldo_pendiente: 93,
  items: [{ linea: 1, cantidad: 1, precio_unitario: 0, descripcion: 'RP' }], ...extra,
})]))[0].result
const decide = async (sale, state, account = null) => (await q(
  'SELECT public.fn_aprobar_rechazar_venta($1, $2, $3) result', [sale, state, account],
))[0].result
try {
  await db.exec(file('scripts/tests/fixtures/rp-phase1.fixture'))
  const original = (await q("SELECT oid, prosrc FROM pg_proc WHERE oid='public.fn_convertir_lead_a_cliente(uuid,uuid)'::regprocedure"))[0]
  await db.exec(file('supabase/migrations/20260920162342_rp_lead_order_approval_phase1.sql'))
  const canonical = (await q("SELECT oid, prosrc FROM pg_proc WHERE oid='public.fn_convertir_lead_a_cliente(uuid,uuid)'::regprocedure"))[0]
  eq(canonical.oid, original.oid)
  eq((await q("SELECT count(*)::int n FROM pg_proc WHERE proname='fn_convertir_lead_a_cliente'"))[0].n, 1)
  eq((await q("SELECT count(*)::int n FROM pg_namespace WHERE nspname='rp_private'"))[0].n, 0)
  eq(canonical.prosrc.includes('for update'), true)
  eq(canonical.prosrc.includes('lead_not_active'), true)
  eq(canonical.prosrc.slice(canonical.prosrc.indexOf('  insert into clientes ('), canonical.prosrc.indexOf('  update leads')),
    original.prosrc.slice(original.prosrc.indexOf('  insert into clientes ('), original.prosrc.indexOf('  update leads')))
  eq((await q("SELECT cmd FROM pg_policies WHERE tablename IN ('venta_items','venta_transacciones') ORDER BY tablename")).map(r=>r.cmd), ['SELECT','SELECT'])
  for (const [n, role, org, parent] of [[1,'admin',100,null],[2,'vendedor',100,3],[3,'distribuidor',100,null],[4,'vendedor',100,null],[5,'admin',200,null],[6,'telemercadeo',100,null],[7,'supervisor_telemercadeo',100,null],[8,'distribuidor',100,null]]) {
    await q('INSERT INTO usuarios(id,rol,org_id,distribuidor_padre_id) VALUES ($1,$2,$3,$4)', [id(n),role,id(org),parent && id(parent)])
  }
  for (let n=10;n<=18;n++) await q("INSERT INTO leads(id,org_id,owner_id,vendedor_id,nombre,estado_pipeline) VALUES ($1,$2,$3,$3,'Prospecto prueba','demo')",[id(n),id(100),id(2)])
  await q('INSERT INTO tele_vendedor_assignments(tele_id,vendedor_id) VALUES ($1,$2)',[id(6),id(2)])
  await actor(2)
  const pending=await create(10)
  eq(pending.cliente_id,null)
  eq(pending.estado_aprobacion,'pendiente_aprobacion')
  eq((await q('SELECT estado_pipeline FROM leads WHERE id=$1',[id(10)]))[0].estado_pipeline,'demo')
  eq((await q('SELECT count(*)::int n FROM clientes'))[0].n,0)
  eq((await q('SELECT count(*)::int n FROM venta_transacciones WHERE venta_id=$1',[pending.venta_id]))[0].n,5)
  eq((await q('SELECT sum(cantidad)::numeric n FROM venta_transacciones WHERE venta_id=$1',[pending.venta_id]))[0].n,'93.00')
  await fail(()=>create(10),/ventas_lead_pendiente_unique/)
  await fail(()=>q("UPDATE ventas SET estado_aprobacion='rechazada' WHERE id=$1",[pending.venta_id]),/Use fn_aprobar/)
  await fail(()=>q('DELETE FROM ventas WHERE id=$1',[pending.venta_id]),/trazabilidad/)
  await fail(()=>q('SELECT public.fn_convertir_lead_a_cliente($1,$2)',[id(10),id(1)]),/orden RP/)
  await fail(()=>decide(pending.venta_id,'aprobada','ACCT'),/Rol no autorizado/)
  for(const n of [1,2,3,6,7]) {
    await actor(n)
    for(const table of ['ventas','venta_items','venta_transacciones']) {
      const col=table==='ventas'?'id':'venta_id'
      eq((await q(`SELECT count(*)::int n FROM ${table} WHERE ${col}=$1`,[pending.venta_id]))[0].n,table==='venta_transacciones'?5:1)
    }
  }
  for(const n of [4,5,8]) {
    await actor(n)
    for(const table of ['ventas','venta_items','venta_transacciones']) eq((await q(`SELECT count(*)::int n FROM ${table}`))[0].n,0)
    await fail(()=>decide(pending.venta_id,'aprobada','ACCT'),/no autorizad|organización|ámbito/i)
  }
  // No direct conversion or audit forgery, even by an authorized approver.
  for (const n of [1,2,3]) {
    await actor(n)
    await fail(()=>q('SELECT public.fn_convertir_lead_a_cliente($1,$2)',[id(10),id(1)]),/orden RP/)
    await fail(()=>q('UPDATE ventas SET decision_aprobacion_por=$1, decision_aprobacion_at=now() WHERE id=$2',[id(n),pending.venta_id]),/Use fn_aprobar/)
    await fail(()=>q("INSERT INTO ventas(org_id,vendedor_id,lead_id,estado_aprobacion,decision_aprobacion_por,decision_aprobacion_at) VALUES ($1,$2,$3,'pendiente_aprobacion',$4,now())",[id(100),id(2),id(12),id(n)]),/auditoría/)
  }
  // Direct writes are unnecessary for all frontend roles: table grants deny DML.
  for (const n of [1,2,3,4,5,6,7,8]) {
    await actor(n)
    for (const table of ['venta_items','venta_transacciones']) {
      await fail(()=>q(`INSERT INTO ${table}(venta_id,org_id) VALUES ($1,$2)`,[pending.venta_id,id(100)]),/permission denied/)
      await fail(()=>q(`UPDATE ${table} SET org_id=org_id WHERE venta_id=$1`,[pending.venta_id]),/permission denied/)
      await fail(()=>q(`DELETE FROM ${table} WHERE venta_id=$1`,[pending.venta_id]),/permission denied/)
    }
  }
  // Verify RLS itself remains read-only even if DML grants are accidentally restored.
  await db.exec('RESET ROLE; GRANT INSERT, UPDATE, DELETE ON venta_items, venta_transacciones TO authenticated')
  for (const n of [1,2,3,6,7]) {
    await actor(n)
    for (const table of ['venta_items','venta_transacciones']) {
      await fail(()=>q(`INSERT INTO ${table}(venta_id,org_id) VALUES ($1,$2)`,[pending.venta_id,id(100)]),/row-level security/)
      eq(await q(`UPDATE ${table} SET org_id=org_id WHERE venta_id=$1 RETURNING id`,[pending.venta_id]),[])
      eq(await q(`DELETE FROM ${table} WHERE venta_id=$1 RETURNING id`,[pending.venta_id]),[])
    }
  }
  await db.exec('RESET ROLE; REVOKE INSERT, UPDATE, DELETE ON venta_items, venta_transacciones FROM authenticated')
  await actor(3)
  await fail(()=>decide(pending.venta_id,'aprobada','  '),/numero_cuenta_financiera/)
  const approved=await decide(pending.venta_id,'aprobada',' ACCT ')
  eq(approved.estado_aprobacion,'aprobada')
  const audit = async (sale) => (await q('SELECT decision_aprobacion_por, decision_aprobacion_at FROM ventas WHERE id=$1',[sale]))[0]
  const approvedAudit = await audit(pending.venta_id)
  eq(approvedAudit.decision_aprobacion_por,id(3))
  assert.ok(approvedAudit.decision_aprobacion_at); checks++
  await actor(1) // Retry by a different approver must not rewrite original audit.
  eq(await decide(pending.venta_id,'aprobada','ACCT'),approved)
  eq(await audit(pending.venta_id),approvedAudit)
  eq((await q('SELECT numero_cuenta_financiera FROM clientes WHERE id=$1',[approved.cliente_id]))[0].numero_cuenta_financiera,'ACCT')
  eq((await q('SELECT estado_pipeline FROM leads WHERE id=$1',[id(10)]))[0].estado_pipeline,'cierre')
  eq(await decide(pending.venta_id,'aprobada','ACCT'),approved)
  eq(await decide(pending.venta_id,'aprobada'),approved)
  eq((await q('SELECT count(*)::int n FROM clientes'))[0].n,1)
  await fail(()=>decide(pending.venta_id,'aprobada','OTHER'),/otra cuenta/)
  await fail(()=>decide(pending.venta_id,'rechazada'),/definitiva/)
  await actor(2)
  const rejected=await create(11)
  await actor(1)
  const rejection=await decide(rejected.venta_id,'rechazada')
  eq(rejection.cliente_id,null)
  const rejectedAudit = await audit(rejected.venta_id)
  eq(rejectedAudit.decision_aprobacion_por,id(1))
  assert.ok(rejectedAudit.decision_aprobacion_at); checks++
  await actor(3)
  eq(await decide(rejected.venta_id,'rechazada'),rejection)
  eq(await audit(rejected.venta_id),rejectedAudit)
  eq(await decide(rejected.venta_id,'rechazada'),rejection)
  await fail(()=>decide(rejected.venta_id,'aprobada','ACCT2'),/definitiva/)
  eq((await q('SELECT estado_pipeline FROM leads WHERE id=$1',[id(11)]))[0].estado_pipeline,'demo')
  await fail(()=>q('SELECT public.fn_convertir_lead_a_cliente($1,$2)',[id(11),id(1)]),/orden RP/)
  await actor(2)
  eq((await create(11)).estado_aprobacion,'pendiente_aprobacion')
  const existing=await create(null,{owner_type:'cliente',lead_id:null,cliente_id:approved.cliente_id})
  eq(existing.estado_aprobacion,'no_aplica')
  eq(existing.cliente_id,approved.cliente_id)
  eq(existing.lead_id,null)
  eq(await audit(existing.venta_id),{decision_aprobacion_por:null,decision_aprobacion_at:null})
  for(const [extra,pattern] of [
    [{subtotal:0},/subtotal/], [{impuesto:-1},/impuesto/], [{cargo_envio:-1},/envío/],
    [{descuento:-1},/descuento/], [{pago_inicial:-1},/pago inicial/], [{pago_inicial:200},/saldo pendiente/],
    [{total:999},/total enviado/], [{saldo_pendiente:999},/saldo_pendiente enviado/],
    [{items:[]},/ítem/], [{items:[{cantidad:0}]},/cantidad/], [{items:[{cantidad:1,precio_unitario:-1}]},/precio unitario/],
  ]) await fail(()=>create(12,extra),pattern)
  eq((await q('SELECT count(*)::int n FROM ventas WHERE lead_id=$1',[id(12)]))[0].n,0)
  await actor(2)
  await fail(()=>q("INSERT INTO ventas(org_id, vendedor_id, lead_id, estado_aprobacion, cliente_id) VALUES ($1,$2,$3,'aprobada',$4)",[id(100),id(2),id(12),approved.cliente_id]),/iniciar pendiente/)
  await fail(()=>q("UPDATE ventas SET lead_id=null, estado_aprobacion='no_aplica' WHERE id=$1",[pending.venta_id]),/origen/)
  await actor(4)
  await fail(()=>q("INSERT INTO ventas(org_id, vendedor_id, lead_id, estado_aprobacion) VALUES ($1,$2,$3,'pendiente_aprobacion')",[id(100),id(4),id(12)]),/No autorizado/)
  await fail(()=>create(12,{vendedor_id:id(4)}),/No autorizado/)
  await actor(5)
  await fail(()=>create(12,{vendedor_id:id(5)}),/organización/)
  await actor(null)
  await fail(()=>decide(pending.venta_id,'aprobada','ACCT'),/Rol no autorizado/)
  await actor(2)
  await fail(()=>create(10),/cerrado o convertido/)
  const manual=(await q('SELECT public.fn_convertir_lead_a_cliente($1,$2) result',[id(13),id(5)]))[0].result
  assert.ok(manual.cliente_id); checks++
  eq((await q('SELECT updated_by FROM leads WHERE id=$1',[id(13)]))[0].updated_by,id(2))
  // Conversion failure must roll back any newly inserted client/account/decision.
  const rollback=await create(14)
  await db.exec("RESET ROLE; CREATE FUNCTION reject_test_client() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.numero_cuenta_financiera = 'FAIL' THEN RAISE EXCEPTION 'test account failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_client BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION reject_test_client();")
  const before=(await q('SELECT count(*)::int n FROM clientes'))[0].n
  await actor(1)
  await fail(()=>decide(rollback.venta_id,'aprobada','FAIL'),/test account failure/)
  eq((await q('SELECT count(*)::int n FROM clientes'))[0].n,before)
  eq((await q('SELECT estado_pipeline FROM leads WHERE id=$1',[id(14)]))[0].estado_pipeline,'demo')
  eq((await q('SELECT estado_aprobacion FROM ventas WHERE id=$1',[rollback.venta_id]))[0].estado_aprobacion,'pendiente_aprobacion')
  eq(await audit(rollback.venta_id),{decision_aprobacion_por:null,decision_aprobacion_at:null})
  await fail(()=>q('SELECT public.fn_convertir_lead_a_cliente($1,$2)',[id(14),id(1)]),/orden RP/)
  await fail(()=>q('UPDATE ventas SET decision_aprobacion_por=null, decision_aprobacion_at=null WHERE id=$1',[pending.venta_id]),/Use fn_aprobar/)
  await fail(()=>q("UPDATE ventas SET decision_aprobacion_at=now() WHERE id=$1",[rejected.venta_id]),/Use fn_aprobar/)
  await db.exec("RESET ROLE; UPDATE leads SET estado_pipeline='descartado' WHERE id='00000000-0000-0000-0000-000000000015'; UPDATE leads SET deleted_at=now() WHERE id='00000000-0000-0000-0000-000000000016';")
  await actor(2)
  await fail(()=>create(15),/cerrado o convertido/)
  await fail(()=>create(16),/no encontrado/)
  await actor(1)
  await fail(()=>decide(rollback.venta_id,null),/decisión/)
  await fail(()=>decide(rollback.venta_id,'no_aplica'),/decisión/)
  await db.exec('RESET ROLE; SET ROLE anon')
  await fail(()=>decide(rollback.venta_id,'aprobada','ACCT'),/permission denied/)
  await actor(2)
  eq((await q('SELECT public.fn_convertir_lead_a_cliente($1,$2) result',[id(13),id(2)]))[0].result.error,'lead_not_active')
  eq((await q('SELECT public.fn_convertir_lead_a_cliente($1,$2) result',[id(999),id(2)]))[0].result.error,'lead_not_found')
  const reassigned=await create(17)
  await db.exec(`RESET ROLE; UPDATE leads SET owner_id='${id(4)}', vendedor_id='${id(4)}' WHERE id='${id(17)}'`)
  await actor(3) // Still owns the sale's seller scope, although the lead was reassigned.
  eq((await decide(reassigned.venta_id,'aprobada','REASSIGNED')).estado_aprobacion,'aprobada')
  eq((await audit(reassigned.venta_id)).decision_aprobacion_por,id(3))
  await actor(5)
  await fail(()=>q('SELECT public.fn_convertir_lead_a_cliente($1,$2)',[id(12),id(2)]),/No autorizado/)
  // The stale, untracked conversion backfill must not silently lose protections.
  const staleDb = new PGlite()
  try {
    await staleDb.exec(file('scripts/tests/fixtures/rp-phase1.fixture').replace('deleted_at is null for update', 'deleted_at is null'))
    await fail(()=>staleDb.exec(file('supabase/migrations/20260920162342_rp_lead_order_approval_phase1.sql')), /definición reconciliada/)
  } finally { await staleDb.close() }
  console.log(`PASS: ${checks} assertions (migration, approval, rejection, idempotency, permissions/RLS, finances, rollback)`)
} catch(error) {
  console.error(error.message, error.detail ?? '', error.where ?? '')
  process.exitCode=1
} finally { await db.close() }
