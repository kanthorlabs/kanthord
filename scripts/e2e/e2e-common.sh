#!/usr/bin/env bash
# e2e-common.sh — shared plumbing for the /e2e phase scripts. SOURCE it.
#
#   E2E_TAG=008 . scripts/e2e/e2e-common.sh
#
# Owns: the run directory layout, the input contract (+ defaults), secret
# handling, the JSON state file, the findings log, and the git/GitHub helpers.
# Every phase script sources this so the input contract lives in exactly one
# place.
#
# Run layout — .data/e2e-<tag>/
#   e2e.env        inputs (mode 0600, supplied by the human)
#   state.json     harness state: ids, oids, outcome
#   findings.jsonl one JSON object per anomaly
#   fixture/       the harness's own copy of the oracle (contract-proof reuses it)
#   graph/         the graph package
#   home/          the repository resource's bare managed home
#   kanthord.db    the isolated DB — never .data/kanthord.db
#   logs/ snapshots/
set -Eeuo pipefail
[ -n "${E2E_COMMON_LOADED:-}" ] && return 0
E2E_COMMON_LOADED=1

# ${BASH_SOURCE[0]:-$0} so an ad-hoc `. scripts/e2e/e2e-common.sh` from a shell works too.
E2E_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
: "${E2E_TAG:?E2E_TAG must be set, e.g. export E2E_TAG=008}"
E2E_RUN_DIR="${E2E_RUN_DIR:-$E2E_REPO_ROOT/.data/e2e-$E2E_TAG}"
# Set it up once and forget it: the repo-global `.data/e2e.env` holds the inputs
# for every run. A per-run `.data/e2e-<tag>/e2e.env` is optional and layers on
# top (it wins), and an explicit E2E_ENV_FILE replaces both.
E2E_GLOBAL_ENV_FILE="${E2E_GLOBAL_ENV_FILE:-$E2E_REPO_ROOT/.data/e2e.env}"
E2E_ENV_FILE="${E2E_ENV_FILE:-$E2E_RUN_DIR/e2e.env}"
E2E_STATE="$E2E_RUN_DIR/state.json"
E2E_FINDINGS="$E2E_RUN_DIR/findings.jsonl"
mkdir -p "$E2E_RUN_DIR/logs" "$E2E_RUN_DIR/snapshots"

e2e_die() {
  echo "error: $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
e2e_load_env() {
  local file="$1" mode
  [ -f "$file" ] || return 0
  # The file is the human's own and holds two secrets, so it must not be
  # world-readable. `stat` differs between BSD and GNU; try both.
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || echo '')"
  case "$mode" in
    600 | 400 | '') : ;;
    *) echo "warning: $file is mode $mode — run: chmod 600 $file" >&2 ;;
  esac
  # E2E_TAG names the run and must never be pinned by a shared file, or every
  # run would collide on the same DB and fixture branch.
  if grep -qE '^[[:space:]]*(export[[:space:]]+)?E2E_TAG=' "$file"; then
    e2e_die "$file sets E2E_TAG — remove that line; the tag is per run (export it in your shell)"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
}

# Global first, then the per-run file so it can override for one experiment.
[ "$E2E_ENV_FILE" != "$E2E_GLOBAL_ENV_FILE" ] && e2e_load_env "$E2E_GLOBAL_ENV_FILE"
e2e_load_env "$E2E_ENV_FILE"

# AI provider — supplied by the human, no defaults for the secrets.
: "${E2E_AI_EFFORT:=high}"
: "${E2E_AI_API:=openai-completions}"
: "${E2E_AI_CONTEXT_WINDOW:=131072}"
: "${E2E_AI_MAX_TOKENS:=8192}"
: "${E2E_AI_PROVIDER_NAME:=e2e-custom-$E2E_TAG}"
# A plain-http or private-network endpoint (a locally served model) is refused by
# `register ai-provider` unless --allow-insecure is passed.
: "${E2E_AI_ALLOW_INSECURE:=0}"
# Repository — kanthord-verify is the throwaway test repo.
: "${E2E_GH_REPO:=kanthorlabs/kanthord-verify}"
: "${E2E_GH_BASE_BRANCH:=main}"
: "${E2E_FIXTURE_BRANCH:=kanthord-e2e/$E2E_TAG-base}"
# Run shape and budgets.
: "${E2E_MODE:=local}"
: "${E2E_MAX_ROUNDS:=6}"
: "${E2E_ROUND_TIMEOUT:=1800}"
: "${E2E_MAX_ATTEMPTS:=2}"
: "${E2E_FORCE_FIXTURE:=0}"
# The agent needs room: the custom-provider defaults are 32768/4096 and kanthord
# does no compaction, and 50 turns is tight for a contract-driven task.
: "${KANTHORD_MAX_TURNS:=90}"
export KANTHORD_MAX_TURNS

export KANTHORD_DB="${KANTHORD_DB:-$E2E_RUN_DIR/kanthord.db}"

e2e_require_inputs() {
  local missing=()
  for v in E2E_AI_BASE_URL E2E_AI_API_KEY E2E_AI_MODEL E2E_GH_TOKEN; do
    # REPLACE_ME is the placeholder the shipped env file carries — an unfilled
    # placeholder is missing input, not a value.
    if [ -z "${!v:-}" ] || [ "${!v}" = "REPLACE_ME" ]; then missing+=("$v"); fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    e2e_die "missing input(s): ${missing[*]} — set them in $E2E_GLOBAL_ENV_FILE (chmod 600), or per run in $E2E_ENV_FILE"
  fi
  case "$E2E_MODE" in
    local | delivery) : ;;
    *) e2e_die "E2E_MODE must be 'local' or 'delivery', got: $E2E_MODE" ;;
  esac
  case "$E2E_AI_API" in
    openai-completions | openai-responses) : ;;
    *) e2e_die "E2E_AI_API must be openai-completions or openai-responses, got: $E2E_AI_API" ;;
  esac
  case "$E2E_AI_EFFORT" in
    minimal | low | medium | high | xhigh) : ;;
    *) e2e_die "E2E_AI_EFFORT must be one of minimal|low|medium|high|xhigh, got: $E2E_AI_EFFORT" ;;
  esac
}

# ---------------------------------------------------------------------------
# Secrets. Never echo a secret; every log passes through e2e_redact.
# ---------------------------------------------------------------------------
e2e_secret_file() {
  local path="$1" value="$2"
  : >"$path"
  chmod 600 "$path"
  printf '%s' "$value" >"$path"
}

# Filter: strips the two secrets from stdin. Assumes neither contains a `|`
# (true for GitHub tokens and OpenAI-style keys).
e2e_redact() {
  local sed_args=()
  [ -n "${E2E_AI_API_KEY:-}" ] && sed_args+=(-e "s|$E2E_AI_API_KEY|<AI_KEY_REDACTED>|g")
  [ -n "${E2E_GH_TOKEN:-}" ] && sed_args+=(-e "s|$E2E_GH_TOKEN|<GH_TOKEN_REDACTED>|g")
  if [ ${#sed_args[@]} -eq 0 ]; then cat; else sed "${sed_args[@]}"; fi
}

# ---------------------------------------------------------------------------
# State (JSON — never a sourced shell file)
# ---------------------------------------------------------------------------
e2e_state_init() {
  [ -f "$E2E_STATE" ] && return 0
  jq -n --arg tag "$E2E_TAG" --arg started "$(date -u +%FT%TZ)" \
    '{tag:$tag, started:$started, outcome:"pending"}' >"$E2E_STATE"
}

e2e_state_set() {
  e2e_state_init
  local tmp="$E2E_STATE.tmp"
  jq --arg k "$1" --arg v "$2" '.[$k]=$v' "$E2E_STATE" >"$tmp" && mv "$tmp" "$E2E_STATE"
}

e2e_state_get() {
  [ -f "$E2E_STATE" ] || return 1
  local v
  v="$(jq -r --arg k "$1" '.[$k] // empty' "$E2E_STATE")"
  [ -n "$v" ] || return 1
  printf '%s' "$v"
}

e2e_state_need() {
  e2e_state_get "$1" || e2e_die "state key '$1' is missing — run the earlier phase first"
}

# ---------------------------------------------------------------------------
# Findings. Never fatal; the report is the output.
#   e2e_finding <phase> <kind> <critical|major|minor> <summary> [k=v ...]
# ---------------------------------------------------------------------------
e2e_finding() {
  local phase="$1" kind="$2" severity="$3" summary="$4"
  shift 4
  local extra='{}' kv
  for kv in "$@"; do
    extra="$(jq -c --arg k "${kv%%=*}" --arg v "${kv#*=}" '.[$k]=$v' <<<"$extra")"
  done
  jq -cn --arg ts "$(date -u +%FT%TZ)" --arg phase "$phase" --arg kind "$kind" \
    --arg severity "$severity" --arg summary "$summary" --argjson extra "$extra" \
    '{ts:$ts,phase:$phase,kind:$kind,severity:$severity,summary:$summary} + $extra' \
    >>"$E2E_FINDINGS"
  echo "FINDING [$severity] $phase/$kind: $summary" >&2
}

# ---------------------------------------------------------------------------
# git + GitHub. The askpass dance mirrors what kanthord's own workspace adapter
# does for https-token auth (src/workspace/local.ts), so a token that works here
# works there.
# ---------------------------------------------------------------------------
E2E_ASKPASS_DIR=""
e2e_git_auth() {
  [ -n "$E2E_ASKPASS_DIR" ] && return 0
  E2E_ASKPASS_DIR="$(mktemp -d)"
  e2e_secret_file "$E2E_ASKPASS_DIR/token" "$E2E_GH_TOKEN"
  printf '#!/bin/sh\ncat "%s"\n' "$E2E_ASKPASS_DIR/token" >"$E2E_ASKPASS_DIR/askpass"
  chmod 700 "$E2E_ASKPASS_DIR/askpass"
  export GIT_ASKPASS="$E2E_ASKPASS_DIR/askpass"
  export GIT_TERMINAL_PROMPT=0
  trap 'rm -rf "$E2E_ASKPASS_DIR"' EXIT
}

# E2E_REMOTE_URL is a harness-debug escape hatch: point the run at a local
# file:// origin to exercise the phase scripts without touching GitHub. A real
# run leaves it unset.
e2e_remote_url() {
  if [ -n "${E2E_REMOTE_URL:-}" ]; then
    printf '%s' "$E2E_REMOTE_URL"
    return 0
  fi
  printf 'https://github.com/%s.git' "$E2E_GH_REPO"
}

# GitHub REST call. Prints the body; returns 1 on a non-2xx status.
e2e_gh() {
  local path="$1" out status
  out="$(mktemp)"
  status="$(curl -sS -o "$out" -w '%{http_code}' \
    -H "Authorization: Bearer $E2E_GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com$path")"
  cat "$out"
  rm -f "$out"
  case "$status" in 2*) return 0 ;; *) return 1 ;; esac
}

# Same, but only the status code (for existence checks).
e2e_gh_status() {
  curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $E2E_GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com$1"
}

e2e_kanthord() {
  node "$E2E_REPO_ROOT/src/main.ts" "$@"
}
