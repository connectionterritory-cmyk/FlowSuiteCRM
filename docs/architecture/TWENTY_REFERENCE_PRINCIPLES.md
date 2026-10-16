# Twenty Reference Principles for FlowSuiteCRM

**Status:** Architecture benchmark / design guardrail  
**Applies to:** Future FlowSuiteCRM architecture reviews and module design  
**Reference:** Twenty CRM concepts reviewed during the FlowSuiteCRM architecture research  

## Purpose

Twenty is a permanent architectural benchmark for FlowSuiteCRM. It is **not** the target product, a dependency, a migration destination, or a source to copy blindly. Every significant architecture decision should compare:

1. **FlowSuite current reality** — repository + actual production catalog.
2. **Twenty reference pattern** — how the comparable CRM concern is separated/modelled.
3. **FlowSuite canonical decision** — what best serves FlowSuite's business and security requirements.

Production remains the source of truth when repository migrations or historical documentation disagree with the live database.

## Core principles retained from the Twenty review

### 1. Separate tenant/workspace from commercial hierarchy

A tenant/workspace is a security and data-isolation boundary. It is not a distributor, salesperson, owner, assignee, recruiter, or display/business name.

FlowSuite canonical semantic targets:

- `org_id` = tenant/workspace identity.
- `organizacion` = legacy/display business name; never a security key.
- `distribuidor_id` / `distribuidor_padre_id` = commercial hierarchy.
- `owner_id` / `created_by` = creator or record ownership, according to the table contract.
- `vendedor_id` = active commercial responsibility.
- `assigned_to` / `asignado_a` = operational responsibility.
- `persona_id` = unified human identity.

Never treat these as interchangeable.

### 2. Person-centric identity

FlowSuite already has `personas`. Preserve and strengthen that direction instead of creating separate human identities for every vertical.

Target concept:

`Tenant -> Persona -> roles/relationships -> Lead / Cliente / Embajador / Insurance / Telecom / Direct Sales / other vertical records`

A person may participate in multiple business lines without becoming multiple unrelated identities.

### 3. Object -> Field -> Relation -> View -> Permission

Use this as a design checklist for CRM capabilities:

- **Object:** What business entity is being represented?
- **Field:** What data belongs to that entity?
- **Relation:** How does it connect to other canonical entities?
- **View:** How can different teams see/filter the same canonical data without duplicating it?
- **Permission:** Who can read or act on it, and at what scope?

Do not convert the entire existing database into a metadata-driven dynamic schema merely to imitate Twenty. Adopt metadata/configurability incrementally where it creates clear value.

### 4. Configurable views over duplicated data

Prefer multiple configurable views of canonical records over separate duplicate tables for each sales use case.

Examples include views such as My Clients, Renewals, Medicare, Life, Internet, Collections, Chargeback Risk, or Follow-up Due, while retaining canonical underlying identities and relationships.

### 5. Core platform vs vertical modules

Target conceptual separation:

**CORE**
- Personas
- Organizations / tenancy
- Users
- Permissions
- Activities
- Tasks
- Communications
- Files
- Audit
- Views
- Workflow foundations

**VERTICAL / DOMAIN MODULES**
- Insurance
- Telecom
- Direct Sales
- Academy
- Commissions
- Collections and other specialized domains where appropriate

Vertical modules should reuse Core identities and services instead of inventing parallel identity/security systems.

### 6. Workflows as a platform capability

Business automation should increasingly use a common workflow layer rather than isolated automation logic in every vertical. Domain-specific rules remain in the relevant module, while orchestration can be shared.

### 7. AI must inherit explicit permissions

Future AI agents must not receive implicit broad access merely because they operate inside FlowSuite.

Target model:

`AI Agent -> Role/Identity -> Allowed Objects -> Allowed Fields -> Allowed Records -> Allowed Actions`

Server-side authorization and database security remain authoritative. AI/UI filtering is not a replacement for RLS or equivalent server-side controls.

### 8. Internal modularity before marketplace complexity

Borrow the extension/app concept as an architectural direction, but prioritize clean internal module boundaries first. Do not build a marketplace or generalized plugin ecosystem before FlowSuite's Core contracts are stable.

### 9. Security stays FlowSuite-specific

Do not replace FlowSuite's server-side security model with Twenty's implementation merely for architectural similarity. FlowSuite must retain and improve its own RLS, authorization, audit, tenant isolation, and least-privilege controls.

Open source does not automatically mean secure. Security-relevant ideas from Twenty must be independently evaluated before adoption.

### 10. License boundary

Study architecture, product behavior, UX patterns, and abstractions. Do not indiscriminately copy Twenty source code into proprietary FlowSuite code. Any source-level reuse requires an explicit license review first.

## FlowSuite-specific guardrails

Before proposing or implementing a major schema/module change, answer:

1. What is the current production truth?
2. Is this Core or a vertical concern?
3. What is the canonical identity (`persona_id`) involved?
4. What is the tenant boundary (`org_id`)?
5. Are ownership, assignment, and commercial hierarchy kept separate?
6. Can a configurable view solve the use case without duplicating data?
7. What relation connects this object to existing canonical objects?
8. What RLS/permission implications exist?
9. What would Twenty's abstraction suggest, and why should FlowSuite adopt or reject it?
10. Does the design improve FlowSuite without forcing a migration/fork/copy of Twenty?

## Current production reconciliation context

The October 2026 read-only production inspection showed that FlowSuite's tenancy model is not yet uniform. Among the findings to reconcile before major tenant redesign:

- `organizations` and `memberships` are not currently present in production.
- `org_id` exists on several core/domain tables but is not uniformly present or populated.
- `personas` is already the identity anchor, but historical `org_id` semantics require reconciliation.
- ownership/commercial hierarchy based RLS coexists with newer tenant-aware RLS.
- MarketingFlow has partial tenant evolution.

These observations are **diagnostic context, not authorization to modify production**.

## Change discipline

This document is a benchmark, not an implementation mandate. Architectural changes still require evidence, impact analysis, migration/rollback planning, security review, and explicit authorization before production changes.

When Twenty and FlowSuite differ, record the reason for the FlowSuite decision rather than forcing equivalence.
