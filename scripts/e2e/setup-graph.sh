#!/usr/bin/env bash
# setup-graph.sh — /e2e phase P2. FAIL FAST: build the resources and import the
# workload graph, then ASSERT the result instead of trusting that the commands
# ran. Deterministic construction has no business being resilient — a wrong graph
# would make every P3 finding meaningless.
#
# Usage: E2E_TAG=<tag> scripts/e2e/setup-graph.sh
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-common.sh"

LOG="$E2E_RUN_DIR/logs/p2-setup-graph.log"
exec 3>&1
log() { echo "$*" | tee -a "$LOG" >&3; }

e2e_require_inputs
[ "$(e2e_state_get p1 || echo no)" = "passed" ] || e2e_die "run provider-cycle.sh first"

PROJECT="$(e2e_state_need projectId)"
PROV="$(e2e_state_need providerId)"
FIXTURE_BRANCH="$(e2e_state_need fixtureBranch)"
FIXTURE_OID="$(e2e_state_need fixtureOid)"
HOME_DIR="$E2E_RUN_DIR/home"
GRAPH_DIR="$E2E_RUN_DIR/graph"

# Exactly one id on stdout, and a zero exit — `head -1` alone would silently
# swallow a failure and hand a log line downstream as an "id".
capture_id() {
  local out
  out="$("$@" 2>>"$LOG")" || e2e_die "command failed: $* (see $LOG)"
  [ "$(wc -l <<<"$out" | tr -d ' ')" = "1" ] || e2e_die "expected one line of output from: $*"
  printf '%s' "$out"
}

log "== P2 setup — project $PROJECT, branch $FIXTURE_BRANCH"

# --- 1. credential + repository -------------------------------------------
TOKEN_FILE="$E2E_RUN_DIR/.gh-token"
e2e_secret_file "$TOKEN_FILE" "$E2E_GH_TOKEN"
CRED="$(capture_id e2e_kanthord create credential --project "$PROJECT" \
  --name "gh-pat-$E2E_TAG" --provider github --value-file "$TOKEN_FILE")"
e2e_state_set credentialId "$CRED"

[ -e "$HOME_DIR" ] && e2e_die "$HOME_DIR already exists — pick a new E2E_TAG"
REPO="$(capture_id e2e_kanthord create repository --project "$PROJECT" \
  --name "verify-$E2E_TAG" --remote-url "$(e2e_remote_url)" --branch "$FIXTURE_BRANCH" \
  --auth https-token --credential "$CRED" --path "$HOME_DIR")"
e2e_state_set repositoryId "$REPO"
log "1. credential + repository — $REPO"

# --- 2. the repository resource records what we asked for ------------------
REPO_JSON="$(e2e_kanthord get repository --id "$REPO" --json)"
[ "$(jq -r '.branch' <<<"$REPO_JSON")" = "$FIXTURE_BRANCH" ] || e2e_die "repository branch is not $FIXTURE_BRANCH"
[ "$(jq -r '.auth.kind' <<<"$REPO_JSON")" = "https-token" ] || e2e_die "repository auth is not https-token"
[ "$(jq -r '.remoteUrl' <<<"$REPO_JSON")" = "$(e2e_remote_url)" ] || e2e_die "repository remoteUrl does not match"
log "2. repository resource records branch + https-token auth"

# --- 3. the managed home starts at the fixture commit ---------------------
# `create repository` prepares the bare managed home; if it is populated it must
# agree with what P0 pushed, or the build would start from an unknown tree.
HOME_OID=""
if [ -d "$HOME_DIR" ]; then
  HOME_OID="$(git -C "$HOME_DIR" rev-parse "refs/heads/$FIXTURE_BRANCH" 2>/dev/null || echo '')"
fi
if [ -n "$HOME_OID" ]; then
  [ "$HOME_OID" = "$FIXTURE_OID" ] ||
    e2e_die "managed home has $FIXTURE_BRANCH @ ${HOME_OID:0:8}, expected the fixture ${FIXTURE_OID:0:8}"
  log "3. managed home at the fixture commit ${FIXTURE_OID:0:8}"
else
  log "3. managed home has no $FIXTURE_BRANCH yet — it is cloned lazily on the first task"
fi

# --- 4. import the graph ---------------------------------------------------
rm -rf "$GRAPH_DIR"
"$E2E_REPO_ROOT/scripts/e2e/make-todo-service-graph.sh" "$GRAPH_DIR" >>"$LOG"
e2e_kanthord import graph "$GRAPH_DIR" --create --project "$PROJECT" --bind source="$REPO" \
  >>"$LOG" 2>&1 || e2e_die "import graph failed — see $LOG"

MANIFEST="$GRAPH_DIR/.kanthord-export.json"
[ -f "$MANIFEST" ] || e2e_die "import produced no $MANIFEST"
INIT="$(jq -r '.initiativeId // empty' "$MANIFEST")"
[ -n "$INIT" ] || e2e_die "manifest has no initiativeId"
OBJ_CORE="$(jq -r '.refToId.objectives["todo-core"] // empty' "$MANIFEST")"
OBJ_PERSIST="$(jq -r '.refToId.objectives["todo-persistence"] // empty' "$MANIFEST")"
[ -n "$OBJ_CORE" ] && [ -n "$OBJ_PERSIST" ] || e2e_die "manifest is missing an objective id"
e2e_state_set initiativeId "$INIT"
e2e_state_set objectiveCoreId "$OBJ_CORE"
e2e_state_set objectivePersistId "$OBJ_PERSIST"
log "4. imported — initiative $INIT"

# --- 5. assert the topology the workload depends on -----------------------
[ "$(jq -r '.objectiveIds | length' "$MANIFEST")" = "2" ] || e2e_die "expected 2 objectives"
[ "$(jq -r '.refToId.tasks | length' "$MANIFEST")" = "4" ] || e2e_die "expected 4 tasks"

TASKS_JSON="$(e2e_kanthord list task --initiative "$INIT" --json)"
[ "$(jq 'length' <<<"$TASKS_JSON")" = "4" ] || e2e_die "list task does not return 4 tasks"
jq -e 'all(.[]; .status == "pending")' <<<"$TASKS_JSON" >/dev/null ||
  e2e_die "not every imported task is pending"

dep_of() { # dep_of <task-ref> -> the single dependency id, or ""
  local id
  id="$(jq -r --arg r "$1" '.refToId.tasks[$r]' "$MANIFEST")"
  jq -r --arg id "$id" '.[] | select(.id==$id) | .dependencies | join(",")' <<<"$TASKS_JSON"
}
[ "$(dep_of store-and-server)" = "" ] || e2e_die "store-and-server should have no dependency"
[ "$(dep_of collection-endpoints)" = "$(jq -r '.refToId.tasks["store-and-server"]' "$MANIFEST")" ] ||
  e2e_die "collection-endpoints does not depend on store-and-server"
[ "$(dep_of item-endpoints)" = "$(jq -r '.refToId.tasks["collection-endpoints"]' "$MANIFEST")" ] ||
  e2e_die "item-endpoints does not depend on collection-endpoints"
[ "$(dep_of sqlite-store)" = "" ] ||
  e2e_die "sqlite-store should have no task dependency (its objective's after: is the gate)"

# The objective edge is the gate that forces two approve-objective steps.
OBJ_EDGE="$(node -e '
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[1]);
const rows=db.prepare("SELECT objectiveId, dependency FROM objective_dependencies").all();
console.log(rows.map((r)=>`${r.objectiveId}<-${r.dependency}`).join(" "));
' "$KANTHORD_DB")"
[ "$OBJ_EDGE" = "$OBJ_PERSIST<-$OBJ_CORE" ] ||
  e2e_die "objective edge is '$OBJ_EDGE', expected '$OBJ_PERSIST<-$OBJ_CORE'"
log "5. topology ok — 2 objectives, 4 tasks, A1<-A2<-A3 chain, persistence after core"

# --- 6. the daemon will find a provider for this initiative ---------------
CHAIN="$(e2e_kanthord list ai-provider --project "$PROJECT" --json | jq --arg id "$PROV" '[.[] | select(.id==$id)] | length')"
[ "$CHAIN" = "1" ] || e2e_die "the project chain no longer resolves the provider"
log "6. provider chain still resolves $PROV"

e2e_state_set p2 "passed"
log ""
log "P2 PASSED — next: scripts/e2e/drive-run.sh"
