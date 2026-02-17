#!/usr/bin/env node

/**
 * FlowSuiteCRM - AI Smoke Test
 * Automated E2E validation for Supabase connection, auth, RLS, and module queries
 * 
 * Required ENV variables:
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_ANON_KEY
 * - E2E_EMAIL
 * - E2E_PASSWORD
 */

import { createClient } from '@supabase/supabase-js'

// ANSI colors for output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
}

const log = {
    info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    section: (msg) => console.log(`\n${colors.bold}${colors.cyan}${msg}${colors.reset}`),
}

let testsPassed = 0
let testsFailed = 0

async function runTest(name, fn) {
    try {
        log.info(`Testing: ${name}`)
        await fn()
        log.success(`PASS: ${name}`)
        testsPassed++
    } catch (error) {
        log.error(`FAIL: ${name}`)
        log.error(`  Error: ${error.message}`)
        testsFailed++
    }
}

async function main() {
    console.log(`\n${colors.bold}FlowSuiteCRM - AI Smoke Test${colors.reset}\n`)

    // 1. Validate environment variables
    log.section('1. Environment Validation')
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
    const email = process.env.E2E_EMAIL
    const password = process.env.E2E_PASSWORD

    if (!supabaseUrl || !supabaseKey) {
        log.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
        process.exit(1)
    }

    if (!email || !password) {
        log.error('Missing E2E_EMAIL or E2E_PASSWORD')
        process.exit(1)
    }

    log.success('Environment variables loaded')

    // 2. Create Supabase client
    log.section('2. Supabase Connection')
    let supabase
    await runTest('Create Supabase client', async () => {
        supabase = createClient(supabaseUrl, supabaseKey)
        if (!supabase) throw new Error('Failed to create Supabase client')
    })

    if (!supabase) {
        log.error('Cannot proceed without Supabase client')
        process.exit(1)
    }

    // 3. Authentication
    log.section('3. Authentication')
    let userId, orgId

    await runTest('Sign in with email/password', async () => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) throw new Error(error.message)
        if (!data.session) throw new Error('No session returned')
        if (!data.user) throw new Error('No user returned')

        userId = data.user.id
        log.info(`  User ID: ${userId}`)
    })

    if (!userId) {
        log.error('Cannot proceed without authenticated user')
        process.exit(1)
    }

    // 4. Membership & Org ID
    log.section('4. Membership & Organization')
    await runTest('Fetch user membership', async () => {
        const { data, error } = await supabase
            .from('memberships')
            .select('org_id, role, organizations(name)')
            .eq('user_id', userId)
            .maybeSingle()

        if (error) throw new Error(error.message)
        if (!data) throw new Error('No membership found for user')
        if (!data.org_id) throw new Error('Membership has no org_id')

        orgId = data.org_id
        log.info(`  Org ID: ${orgId}`)
        log.info(`  Role: ${data.role}`)
        log.info(`  Org Name: ${data.organizations?.name || 'N/A'}`)
    })

    if (!orgId) {
        log.error('Cannot proceed without org_id')
        process.exit(1)
    }

    // 5. RLS Enforcement
    log.section('5. RLS Enforcement')
    await runTest('Verify RLS blocks unauthorized access', async () => {
        // Try to access data without org_id filter (should return empty or error)
        const { data, error } = await supabase
            .from('oportunidades')
            .select('id, org_id')
            .limit(1)

        // RLS should filter by org_id automatically
        if (error && !error.message.includes('permission denied')) {
            throw new Error(`Unexpected error: ${error.message}`)
        }

        // If data returned, verify it's for our org
        if (data && data.length > 0) {
            const hasOtherOrg = data.some((row) => row.org_id !== orgId)
            if (hasOtherOrg) {
                throw new Error('RLS failed: returned data from other orgs')
            }
        }

        log.info('  RLS is enforcing org_id filtering')
    })

    // 6. Module Smoke Queries
    log.section('6. Module Smoke Queries')

    await runTest('Pipeline: query oportunidades', async () => {
        const { data, error } = await supabase
            .from('oportunidades')
            .select('id, titulo, producto_objetivo, estado')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} oportunidades`)
    })

    await runTest('Cliente360: query contactos_canonical', async () => {
        const { data, error } = await supabase
            .from('contactos_canonical')
            .select('id, nombre, email')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} contactos`)
    })

    await runTest('Servicio: query servicios', async () => {
        const { data, error } = await supabase
            .from('servicios')
            .select('id, titulo, estado')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} servicios`)
    })

    await runTest('Agua: query cliente_componentes', async () => {
        const { data, error } = await supabase
            .from('cliente_componentes')
            .select('id, componente, next_change_at')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} componentes`)
    })

    await runTest('Cartera: query transaccionesrp', async () => {
        const { data, error } = await supabase
            .from('transaccionesrp')
            .select('id, monto, estado')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} transacciones`)
    })

    await runTest('Cartera: query cob_gestiones', async () => {
        const { data, error } = await supabase
            .from('cob_gestiones')
            .select('id, tipo_gestion')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} gestiones`)
    })

    await runTest('TeamHub: query canales', async () => {
        const { data, error } = await supabase
            .from('canales')
            .select('id, nombre')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} canales`)
    })

    await runTest('TeamHub: query anuncios', async () => {
        const { data, error } = await supabase
            .from('anuncios')
            .select('id, titulo')
            .eq('org_id', orgId)
            .limit(5)

        if (error) throw new Error(error.message)
        log.info(`  Found ${data?.length || 0} anuncios`)
    })

    // Final Report
    log.section('Test Results')
    const total = testsPassed + testsFailed
    console.log(`Total: ${total}`)
    console.log(`${colors.green}Passed: ${testsPassed}${colors.reset}`)
    console.log(`${colors.red}Failed: ${testsFailed}${colors.reset}`)

    if (testsFailed > 0) {
        console.log(`\n${colors.red}${colors.bold}SMOKE TEST FAILED${colors.reset}\n`)
        process.exit(1)
    } else {
        console.log(`\n${colors.green}${colors.bold}✓ ALL TESTS PASSED${colors.reset}\n`)
        process.exit(0)
    }
}

main().catch((error) => {
    log.error(`Unhandled error: ${error.message}`)
    console.error(error)
    process.exit(1)
})
