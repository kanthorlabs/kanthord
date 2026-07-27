#!/usr/bin/env bash
# provider-cycle.sh — /e2e phase P1. FAIL FAST: the credential lifecycle for a
# user-supplied OpenAI-compatible provider, end to end, against the real endpoint.
#
# Naming: for a URL + key + model there is no `login provider` (that command is
# OAuth-only). The real lifecycle is register -> probe -> logout -> reactivate,
# which is the custom-provider equivalent of logging in and out.
#
# Note on step 4: re-registering under the same name REACTIVATES the row — same
# id, credential replaced, and the stored model/base-url/api/effort are RETAINED
# (a re-register is not a way to change configuration).
#
# Usage: E2E_TAG=<tag> scripts/e2e/provider-cycle.sh
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-common.sh"

LOG="$E2E_RUN_DIR/logs/p1-provider-cycle.log"
exec 3>&1
log() { echo "$*" | tee -a "$LOG" >&3; }

e2e_require_inputs
[ "$(e2e_state_get p0 || echo no)" = "passed" ] || e2e_die "run preflight.sh first"

DETERMINISTIC_PROMPT='Reply with exactly KANTHORD_E2E_OK and nothing else.'
DATE_PROMPT='What is today'"'"'s date?'
KEY_FILE="$E2E_RUN_DIR/.ai-key"
e2e_secret_file "$KEY_FILE" "$E2E_AI_API_KEY"

log "== P1 provider cycle — $E2E_AI_PROVIDER_NAME ($E2E_AI_API, $E2E_AI_MODEL)"

# --- 0. isolated DB + the project (needed for the chain assertions) --------
if [ -f "$KANTHORD_DB" ]; then
  e2e_die "$KANTHORD_DB already exists — the first-provider-wins default rule needs a fresh DB. Pick a new E2E_TAG or delete the file."
fi
e2e_kanthord db migrate >>"$LOG" 2>&1
PROJECT="$(e2e_kanthord create project --name "todo-service-$E2E_TAG" | head -1)"
[ -n "$PROJECT" ] || e2e_die "create project printed no id"
e2e_state_set projectId "$PROJECT"
log "db + project ok — $PROJECT"

register_provider() {
  local insecure=()
  [ "$E2E_AI_ALLOW_INSECURE" = "1" ] && insecure=(--allow-insecure)
  e2e_kanthord register ai-provider \
    --name "$E2E_AI_PROVIDER_NAME" \
    --api "$E2E_AI_API" \
    --custom-provider-id "e2e-$E2E_TAG" \
    --base-url "$E2E_AI_BASE_URL" \
    --model "$E2E_AI_MODEL" \
    --effort "$E2E_AI_EFFORT" \
    --context-window "$E2E_AI_CONTEXT_WINDOW" \
    --max-tokens "$E2E_AI_MAX_TOKENS" \
    --value-file "$KEY_FILE" "${insecure[@]}" 2>>"$LOG" | head -1
}

provider_field() {
  e2e_kanthord get ai-provider --id "$1" --json 2>>"$LOG" | jq -r --arg k "$2" '.[$k] // empty'
}

probe() {
  e2e_kanthord test ai-provider --id "$1" --prompt "$2" 2>&1 | e2e_redact
}

# --- 1. register (the "login") --------------------------------------------
PROV="$(register_provider)"
[ -n "$PROV" ] || e2e_die "register ai-provider printed no id — see $LOG"
e2e_state_set providerId "$PROV"
[ "$(provider_field "$PROV" state)" = "active" ] || e2e_die "new provider is not active"
[ "$(provider_field "$PROV" isDefault)" = "true" ] || e2e_die "first provider did not become the default"
[ "$(provider_field "$PROV" model)" = "$E2E_AI_MODEL" ] || e2e_die "stored model does not echo back"
[ "$(provider_field "$PROV" baseUrl)" = "$E2E_AI_BASE_URL" ] || e2e_die "stored baseUrl does not echo back"
[ "$(provider_field "$PROV" effort)" = "$E2E_AI_EFFORT" ] || e2e_die "stored effort does not echo back"
log "1. registered — $PROV (active, default, config echoes back)"

# --- 2. assign to the project + the resolved chain -------------------------
e2e_kanthord assign ai-provider --project "$PROJECT" --provider "$PROV" >>"$LOG" 2>&1
CHAIN_COUNT="$(e2e_kanthord list ai-provider --project "$PROJECT" --json | jq --arg id "$PROV" '[.[] | select(.id==$id)] | length')"
[ "$CHAIN_COUNT" = "1" ] || e2e_die "project chain contains the provider $CHAIN_COUNT times, expected exactly 1"
log "2. assigned — project chain resolves to it exactly once"

# --- 3. probe: the gate is a deterministic literal, not a date -------------
ANSWER="$(probe "$PROV" "$DETERMINISTIC_PROMPT")" ||
  e2e_die "test ai-provider failed: $ANSWER"
printf 'deterministic probe answer: %s\n' "$ANSWER" >>"$LOG"
case "$ANSWER" in
  *KANTHORD_E2E_OK*) log "3. probe ok — model returned the requested literal" ;;
  *) e2e_die "probe did not return KANTHORD_E2E_OK — got: $ANSWER" ;;
esac

# The date question the run is documented to ask. Recorded as EVIDENCE only:
# asserting on a model's prose is flaky, and a wrong date is a model quality
# observation, not a kanthord defect.
DATE_ANSWER="$(probe "$PROV" "$DATE_PROMPT" || echo '<probe failed>')"
printf 'date probe answer: %s\n' "$DATE_ANSWER" >>"$LOG"
e2e_state_set dateProbeAnswer "$DATE_ANSWER"
log "   date probe (evidence only): $DATE_ANSWER"
if [ -z "$DATE_ANSWER" ] || [ "$DATE_ANSWER" = "<probe failed>" ]; then
  e2e_finding P1 empty-date-probe minor "the date prompt returned no text" providerId="$PROV"
fi

# --- 4. logout: the refusal first, then the real thing ---------------------
# The sole provider IS the default, so a bare logout must be refused.
if e2e_kanthord logout ai-provider --id "$PROV" >>"$LOG" 2>&1; then
  e2e_finding P1 missing-default-guard major \
    "bare 'logout ai-provider' on the sole default succeeded; it must be refused" providerId="$PROV"
  e2e_die "bare logout of the default provider was accepted — refusing to continue on a wrong-state DB"
fi
[ "$(provider_field "$PROV" state)" = "active" ] || e2e_die "the refused logout still changed the state"
log "4a. bare logout refused, provider still active"

e2e_kanthord logout ai-provider --id "$PROV" --confirm-no-default >>"$LOG" 2>&1
[ "$(provider_field "$PROV" state)" = "logged_out" ] || e2e_die "logout did not flip the state"
if probe "$PROV" "$DETERMINISTIC_PROMPT" >>"$LOG" 2>&1; then
  e2e_die "test ai-provider still worked after logout"
fi
CHAIN_AFTER="$(e2e_kanthord list ai-provider --project "$PROJECT" --json | jq 'length')"
[ "$CHAIN_AFTER" = "0" ] || e2e_die "project chain still has $CHAIN_AFTER entries after logout"
log "4b. logged out — probe refused, project chain empty"

# --- 5. reactivate (the second "login") -----------------------------------
PROV2="$(register_provider)"
[ "$PROV2" = "$PROV" ] || e2e_die "re-register returned a NEW id ($PROV2); reactivation must reuse $PROV"
[ "$(provider_field "$PROV" state)" = "active" ] || e2e_die "reactivated provider is not active"
[ "$(provider_field "$PROV" isDefault)" = "true" ] || e2e_die "default pointer was not restored on reactivation"
ANSWER2="$(probe "$PROV" "$DETERMINISTIC_PROMPT")" || e2e_die "probe failed after reactivation: $ANSWER2"
case "$ANSWER2" in
  *KANTHORD_E2E_OK*) : ;;
  *) e2e_die "post-reactivation probe did not return the literal — got: $ANSWER2" ;;
esac
CHAIN_BACK="$(e2e_kanthord list ai-provider --project "$PROJECT" --json | jq --arg id "$PROV" '[.[] | select(.id==$id)] | length')"
[ "$CHAIN_BACK" = "1" ] || e2e_die "project chain did not recover after reactivation"
log "5. reactivated — same id, default restored, probe green, chain recovered"

e2e_state_set p1 "passed"
log ""
log "P1 PASSED — next: scripts/e2e/setup-graph.sh"
