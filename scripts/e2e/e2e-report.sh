#!/usr/bin/env bash
# e2e-report.sh — /e2e phase P5. Always runnable, whatever happened earlier.
#
# Split of labour: this script produces the DETERMINISTIC part — the phase
# outcomes, the chronological evidence index, the findings grouped by kind, and
# the cleanup commands. Root-cause grouping, severity judgement and the
# `action:YES/NO` call are the agent's job, and the script leaves a clearly
# marked section for them. It never pretends to have grouped anything.
#
# The report lands in .agent/e2e/<tag>/ — deliberately NOT under
# .agent/plan/epics/, which is reserved for EPICs (template + Proof command).
# Actionable groups become EPICs afterwards, separately.
#
# Usage: E2E_TAG=<tag> scripts/e2e/e2e-report.sh
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-common.sh"

OUT_DIR="$E2E_REPO_ROOT/.agent/e2e/$E2E_TAG"
REPORT="$OUT_DIR/report.md"
mkdir -p "$OUT_DIR"
e2e_state_init
[ -f "$E2E_FINDINGS" ] || : >"$E2E_FINDINGS"

state() { jq -r --arg k "$1" '.[$k] // "—"' "$E2E_STATE"; }

# Only contract-proof.sh (P4) resolves `outcome`, so a chain that stops earlier
# leaves it at the init value `pending` — which is not one of the three verdicts
# and reads like "still running". Derive it from the phases that did run, and
# write it back so state.json and the report never disagree.
resolve_outcome() {
  case "$(state outcome)" in
  passed | blocked | failed) return 0 ;;
  esac
  local verdict="" p
  for p in p0 p1 p2 p3 p4; do
    case "$(state "$p")" in
    failed) verdict="failed"; break ;;
    blocked) [ -n "$verdict" ] || verdict="blocked" ;;
    esac
  done
  [ -n "$verdict" ] || return 0
  e2e_state_set outcome "$verdict"
}
resolve_outcome
count_kind() { jq -r --arg k "$1" 'select(.kind==$k) | .kind' "$E2E_FINDINGS" 2>/dev/null | wc -l | tr -d ' '; }

{
  echo "# /e2e run \`$E2E_TAG\` — evidence report"
  echo
  echo "Generated $(date -u +%FT%TZ) by \`scripts/e2e/e2e-report.sh\`."
  echo "Workload: the mid-level todo-service contract build (2 objectives, 4 tasks)."
  echo
  echo "## Outcome"
  echo
  echo "| phase | result |"
  echo "| --- | --- |"
  echo "| P0 preflight + fixture push | $(state p0) |"
  echo "| P1 provider cycle | $(state p1) |"
  echo "| P2 setup + import | $(state p2) |"
  echo "| P3 drive (rounds used: $(state round)) | $(state p3) |"
  echo "| P4 contract proof | $(state p4) |"
  echo "| **overall** | **$(state outcome)** |"
  echo
  echo "\`passed\` = provider lifecycle, graph execution, local landing and the"
  echo "harness-owned program proof all demonstrated (plus the remote publish in"
  echo "delivery mode). \`blocked\` = the run stopped without a usable verdict."
  echo "\`failed\` = something was demonstrably wrong."
  echo
  echo "## Run facts"
  echo
  echo "- mode: \`$E2E_MODE\`  ·  model: \`${E2E_AI_MODEL:-—}\`  ·  api: \`$E2E_AI_API\`  ·  effort: \`$E2E_AI_EFFORT\`"
  echo "- context window: \`$E2E_AI_CONTEXT_WINDOW\`  ·  max tokens: \`$E2E_AI_MAX_TOKENS\`  ·  max turns: \`$KANTHORD_MAX_TURNS\`"
  echo "- repo: \`$E2E_GH_REPO\`  ·  base branch: \`$(state baseBranch)\` @ \`$(state baseOid)\`"
  echo "- fixture branch: \`$(state fixtureBranch)\` @ \`$(state fixtureOid)\`"
  echo "- initiative: \`$(state initiativeId)\`  ·  objectives: \`$(state objectiveCoreId)\`, \`$(state objectivePersistId)\`"
  echo "- landed commit: \`$(state landedOid)\`  ·  published: \`$(state publishedOid)\`"
  echo "- date-probe answer (evidence only, never asserted on): $(state dateProbeAnswer)"
  echo
  echo "## Findings by kind (deterministic tally)"
  echo
  if [ -s "$E2E_FINDINGS" ]; then
    echo "| kind | count | worst severity |"
    echo "| --- | --- | --- |"
    jq -r '.kind' "$E2E_FINDINGS" | sort -u | while IFS= read -r kind; do
      # critical < major < minor happens to be alphabetical, so a plain sort works.
      worst="$(jq -r --arg k "$kind" 'select(.kind==$k) | .severity' "$E2E_FINDINGS" |
        sort | head -1)"
      echo "| \`$kind\` | $(count_kind "$kind") | $worst |"
    done
  else
    echo "No findings were recorded."
  fi
  echo
  echo "## Chronological evidence"
  echo
  if [ -s "$E2E_FINDINGS" ]; then
    jq -r '"- `\(.ts)` **\(.phase)/\(.kind)** [\(.severity)] — \(.summary)" +
           (if .taskId then " (task `\(.taskId)`)" else "" end) +
           (if .objectiveId then " (objective `\(.objectiveId)`)" else "" end) +
           (if .round then " (round \(.round))" else "" end) +
           (if .log then " → `\(.log)`" else "" end)' "$E2E_FINDINGS"
  else
    echo "- nothing recorded"
  fi
  echo
  echo "## Artifacts"
  echo
  echo "Secrets are redacted in every log, but these files describe a real repo and"
  echo "a real run — read them, do not paste them wholesale."
  echo
  for f in "$E2E_RUN_DIR"/logs/*.log; do
    [ -f "$f" ] || continue
    echo "- \`${f#"$E2E_REPO_ROOT/"}\` ($(wc -l <"$f" | tr -d ' ') lines)"
  done
  for f in "$E2E_RUN_DIR"/snapshots/round-*.json; do
    [ -f "$f" ] || continue
    echo "- \`${f#"$E2E_REPO_ROOT/"}\`"
  done
  [ -f "$E2E_RUN_DIR/snapshots/events.jsonl" ] &&
    echo "- \`${E2E_RUN_DIR#"$E2E_REPO_ROOT/"}/snapshots/events.jsonl\` ($(wc -l <"$E2E_RUN_DIR/snapshots/events.jsonl" | tr -d ' ') events)"
  echo "- \`${E2E_FINDINGS#"$E2E_REPO_ROOT/"}\`"
  echo "- \`${E2E_STATE#"$E2E_REPO_ROOT/"}\`"
  echo
  echo "## Reproducing a finding"
  echo
  echo "\`\`\`sh"
  echo "export E2E_TAG=$E2E_TAG                  # inputs are re-read from .data/e2e-$E2E_TAG/e2e.env"
  echo "scripts/e2e/drive-run.sh                # resumes: same DB, same graph, same attempt counters"
  echo "scripts/e2e/contract-proof.sh           # re-proves the landed tree"
  echo "\`\`\`"
  echo
  echo "## Cleanup (never run automatically)"
  echo
  echo "This repo is reused every run, so branches accumulate. Delete this run's"
  echo "branches when you are done with the evidence:"
  echo
  echo "\`\`\`sh"
  echo "git push --delete https://github.com/$E2E_GH_REPO.git $(state fixtureBranch)"
  [ "$(state landedOid)" != "—" ] &&
    echo "git push --delete https://github.com/$E2E_GH_REPO.git kanthord/init/$(state initiativeId)"
  echo "rm -rf ${E2E_RUN_DIR#"$E2E_REPO_ROOT/"}"
  echo "\`\`\`"
  echo
  echo "## Blockers and suggestions — AGENT WRITES THIS SECTION"
  echo
  echo "Group the findings above by ROOT CAUSE (one cascading failure is one item,"
  echo "not five), then one bullet per item in exactly this format:"
  echo
  echo "\`<B1/S1> - action:<YES/NO> - <name> - <description>\`"
  echo
  echo "\`B\`=blocker, \`S\`=suggestion, numbered; \`action:YES\` when it should be"
  echo "applied, \`action:NO\` for a no-op or won't-do. Add the severity"
  echo "(\`critical|major|minor\`) and point at the artifact that shows it. Then"
  echo "\`/debate\` the fix approach and author the fix EPIC with a program-level"
  echo "\`Proof:\` — this report is evidence, it is not an EPIC."
  echo
  echo "<!-- agent: replace this line with the grouped assessment -->"
} >"$REPORT"

echo "report written: ${REPORT#"$E2E_REPO_ROOT/"}"
echo "overall outcome: $(state outcome)"
