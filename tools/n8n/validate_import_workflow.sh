#!/usr/bin/env bash
set -euo pipefail

# Validate critical invariants for:
# IMPORT - Imagenes Drive a CRM (LvZbzdjpji1pu81u / RFN0rJZlo86HNgRj style)
#
# Usage:
#   tools/n8n/validate_import_workflow.sh <workflow.json>
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <workflow.json>" >&2
  exit 1
fi

file="$1"
if [[ ! -f "$file" ]]; then
  echo "ERROR: File not found: $file" >&2
  exit 1
fi

failures=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

get_js() {
  local node_name="$1"
  jq -r --arg n "$node_name" '.nodes[] | select(.name==$n) | .parameters.jsCode // empty' "$file"
}

get_url() {
  local node_name="$1"
  jq -r --arg n "$node_name" '.nodes[] | select(.name==$n) | .parameters.url // empty' "$file"
}

parse_js="$(get_js "Code - Parsear OpenAI")"
mapeo_c_js="$(get_js "Mapeo C")"
mapeo_l_js="$(get_js "Mapeo L")"
upsert_url="$(get_url "Upsert Cliente")"

if [[ -z "$parse_js" ]]; then
  fail "Node 'Code - Parsear OpenAI' not found or jsCode empty."
else
  if grep -q "saldo_actual: *cuenta\.saldo_actual" <<<"$parse_js"; then
    pass "Parse node uses saldo_actual <- cuenta.saldo_actual."
  else
    fail "Parse node does not map saldo_actual <- cuenta.saldo_actual."
  fi

  if grep -q "saldo_total:" <<<"$parse_js"; then
    fail "Parse node still contains saldo_total output key."
  else
    pass "Parse node no longer uses saldo_total output key."
  fi
fi

if [[ -z "$mapeo_c_js" ]]; then
  fail "Node 'Mapeo C' not found or jsCode empty."
else
  if grep -q "if (!v) return null;" <<<"$mapeo_c_js" \
    && grep -q "digits.length < 7" <<<"$mapeo_c_js" \
    && grep -q "/0{4,}\$/.test(digits)" <<<"$mapeo_c_js"; then
    pass "Mapeo C uses validated cP() (min length + trailing zeros guard)."
  else
    fail "Mapeo C does not use validated cP()."
  fi
fi

if [[ -z "$mapeo_l_js" ]]; then
  fail "Node 'Mapeo L' not found or jsCode empty."
else
  if grep -q "if (!v) return null;" <<<"$mapeo_l_js" \
    && grep -q "digits.length < 7" <<<"$mapeo_l_js" \
    && grep -q "/0{4,}\$/.test(digits)" <<<"$mapeo_l_js"; then
    pass "Mapeo L uses validated cP() (min length + trailing zeros guard)."
  else
    fail "Mapeo L does not use validated cP()."
  fi
fi

if [[ -z "$upsert_url" ]]; then
  fail "Node 'Upsert Cliente' not found or url empty."
else
  expected_url="https://rxiarmbosgivaplygqug.supabase.co/rest/v1/clientes?on_conflict=org_id,telefono"
  if [[ "$upsert_url" == "$expected_url" ]]; then
    pass "Upsert Cliente URL includes on_conflict=org_id,telefono."
  else
    fail "Upsert Cliente URL mismatch. Got: $upsert_url"
  fi
fi

if [[ $failures -gt 0 ]]; then
  echo
  echo "Validation failed with $failures issue(s)." >&2
  exit 1
fi

echo
echo "Validation OK."
