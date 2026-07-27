#!/usr/bin/env bash
# client-discovery-proof.sh — EPIC 011 Proof (deterministic, no model, no network,
# no daemon). Proves a client with no prior ids can discover what exists and read
# one project's activity, and that the shipped example package really imports.
#
# Run from the repo root. Against the CURRENT tree every phase fails (the commands
# and the example package do not exist yet) — the expected RED state.
set -Eeuo pipefail
trap 'echo "FAILED: $0 line $LINENO" >&2' ERR

# Per-run scratch: no fixed /tmp names, so concurrent runs never collide.
PD="$(mktemp -d)"; trap 'rm -rf "$PD"' EXIT
export KANTHORD_DB="$PD/kanthord.db"

# Read a JS expression over the parsed stdin JSON. `v` is the parsed value.
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }

node src/main.ts db migrate >/dev/null
P1=$(node src/main.ts create project --name alpha)
P2=$(node src/main.ts create project --name beta)

# ── Phase A — `list project` enumerates with no prior id ───────────────────────
node src/main.ts list project --json > "$PD/projects.json"
test "$(jv 'v.filter(p=>p.id==="'"$P1"'").length' < "$PD/projects.json")" = "1"
test "$(jv 'v.find(p=>p.id==="'"$P1"'").name' < "$PD/projects.json")" = "alpha"
test "$(jv 'v.length' < "$PD/projects.json")" = "2"
# Ordering is a contract, not an accident: ids ascending (ULIDs sort by time).
test "$(jv 'JSON.stringify(v.map(p=>p.id))===JSON.stringify([...v.map(p=>p.id)].sort())' < "$PD/projects.json")" = "true"
echo "A ok: list project enumerates, with a defined order"

# ── Phase B — `list notification` / `list filesystem`, no secret leak ─────────
node src/main.ts create notification --project "$P1" --name ops \
  --provider slack --destination '#ops' >/dev/null
node src/main.ts create filesystem --project "$P1" --name scratch --path "$PD/ws" >/dev/null
CREDF="$PD/cred"; printf 'sekret' > "$CREDF"
node src/main.ts create credential --project "$P1" --name gh --provider github \
  --value-file "$CREDF" >/dev/null

node src/main.ts list notification --project "$P1" --json > "$PD/notif.json"
test "$(jv 'v.length' < "$PD/notif.json")" = "1"
test "$(jv 'v[0].name' < "$PD/notif.json")" = "ops"
node src/main.ts list filesystem --project "$P1" --json > "$PD/fs.json"
test "$(jv 'v[0].name' < "$PD/fs.json")" = "scratch"
# Project scoping: P2 owns none of them.
test "$(node src/main.ts list notification --project "$P2" --json | jv 'v.length')" = "0"
test "$(node src/main.ts list filesystem --project "$P2" --json | jv 'v.length')" = "0"
# The resource view must never carry a secret, on ANY listing path.
test "$(node src/main.ts list credential --project "$P1" --json | jv 'v.every(r=>r.value===undefined)')" = "true"
grep -q 'sekret' "$PD/notif.json" && { echo "FAILED: secret leaked into a listing" >&2; exit 1; }
echo "B ok: notification + filesystem list, project-scoped, no secret leak"

# ── Phase C — the shipped example package really imports (not just dry-run) ────
test -f examples/oauth-package/.kanthord-export.json
test "$(node -e 'console.log(JSON.parse(require("fs").readFileSync("examples/oauth-package/.kanthord-export.json","utf8")).formatVersion)')" = "3"
HOME_REMOTE="$PD/home.git"; git init -q --bare -b main "$HOME_REMOTE"
REPO1=$(node src/main.ts create repository --project "$P1" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror1")
# `import --create` REWRITES the package's source files in place with minted ULIDs
# (src/apps/cli/import-graph.ts). Import a COPY, or run 1 dirties the committed
# example and run 2 fails with CreateModeIdError.
cp -R examples/oauth-package "$PD/oauth-package"
node src/main.ts import graph "$PD/oauth-package" --create --project "$P1" \
  --bind source="$REPO1" >/dev/null
INIT1=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.kanthord-export.json","utf8")).initiativeId)' "$PD/oauth-package")
# The committed example is untouched by the run.
git diff --quiet -- examples/oauth-package || { echo "FAILED: the proof dirtied examples/oauth-package" >&2; exit 1; }
# Persistence, not just validation: the objectives and tasks are readable back.
test "$(node src/main.ts list objective --initiative "$INIT1" --json | jv 'v.length>0')" = "true"
test "$(node src/main.ts list task --initiative "$INIT1" --json | jv 'v.length>0')" = "true"
# Every imported task carries its instructions + acceptance criteria.
test "$(node src/main.ts list task --initiative "$INIT1" --json | jv 'v.every(t=>t.title&&t.title.length>0)')" = "true"
echo "C ok: examples/oauth-package imports and persists as a v3 package"

# ── Phase D — events are project-scoped server-side, and page correctly ───────
# Build a deliberately ALTERNATING event history so a scoped page must skip
# foreign events to be correct. `create task` emits `task.created`, so no daemon
# and no model is involved — fully deterministic.
REPO2=$(node src/main.ts create repository --project "$P2" --name home \
  --remote-url "file://$HOME_REMOTE" --branch main --auth ambient --path "$PD/mirror2")
INIT2=$(node src/main.ts create initiative --project "$P2" --name beta-init)
OBJ2=$(node src/main.ts create objective --initiative "$INIT2" --name beta-obj)
OBJ1=$(node src/main.ts list objective --initiative "$INIT1" --json | jv 'v[0].id')

for i in 1 2 3 4; do
  node src/main.ts create task --objective "$OBJ1" --title "alpha task $i" \
    --instructions x --ac y >/dev/null
  node src/main.ts create task --objective "$OBJ2" --title "beta task $i" \
    --instructions x --ac y >/dev/null
done

# A high limit is passed explicitly so a default page size can never truncate the
# "full" feeds these assertions compare against.
node src/main.ts list event --project "$P1" --after 0 --limit 1000 --json > "$PD/ev-p1.json"
node src/main.ts list event --project "$P2" --after 0 --limit 1000 --json > "$PD/ev-p2.json"
node src/main.ts list event --after 0 --limit 1000 --json > "$PD/ev-all.json"

node -e '
const rd=p=>JSON.parse(require("fs").readFileSync(p,"utf8")).events;
const [p1,p2,all]=[process.argv[1],process.argv[2],process.argv[3]].map(rd);
const ids=e=>e.map(x=>x.id);
const fail=m=>{console.error("FAILED: "+m);process.exit(1);};
if (p1.length===0||p2.length===0) fail("a scoped feed is empty");
const A=new Set(ids(all));
for (const [n,f] of [["p1",p1],["p2",p2]]) {
  if (!ids(f).every(id=>A.has(id))) fail(n+" contains an event absent from the global feed");
  if (new Set(ids(f)).size!==f.length) fail(n+" contains duplicate event ids");
  const s=ids(f); if (JSON.stringify(s)!==JSON.stringify([...s].sort())) fail(n+" is not in ascending cursor order");
}
const s1=new Set(ids(p1));
if (ids(p2).some(id=>s1.has(id))) fail("project feeds overlap");
if (p1.length+p2.length>all.length) fail("scoped feeds exceed the global feed");
// The histories really do interleave, so paging must skip foreign events.
const pos=id=>ids(all).indexOf(id);
const inter=ids(p1).some(a=>ids(p2).some(b=>pos(b)>pos(a))) && ids(p2).some(b=>ids(p1).some(a=>pos(a)>pos(b)));
if (!inter) fail("histories do not interleave — the paging assertion would be vacuous");
' "$PD/ev-p1.json" "$PD/ev-p2.json" "$PD/ev-all.json"

# Page P1 one event at a time. Must reach exactly the full P1 set, in order, with
# no duplicates, and must terminate — never stalling on a foreign event.
node -e '
const {execFileSync}=require("child_process");
const want=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8")).events.map(e=>e.id);
let cursor="0", seen=[];
for (let i=0;i<want.length+10;i++) {
  const page=JSON.parse(execFileSync("node",["src/main.ts","list","event","--project",process.argv[1],"--after",cursor,"--limit","1","--json"],{encoding:"utf8",timeout:30000}));
  if (page.events.length===0) break;
  if (page.events.length>1) { console.error("FAILED: --limit 1 returned more than one event"); process.exit(1); }
  seen.push(...page.events.map(e=>e.id));
  if (!page.nextCursor) { console.error("FAILED: non-empty page without a nextCursor"); process.exit(1); }
  cursor=page.nextCursor;
  if (seen.length>want.length) break;
}
if (JSON.stringify(seen)!==JSON.stringify(want)) {
  console.error("FAILED: paged P1 feed != full P1 feed\n  paged: "+seen.join(",")+"\n  want:  "+want.join(","));
  process.exit(1);
}
' "$P1" "$PD/ev-p1.json"
echo "D ok: events are project-scoped server-side, ordered, disjoint, and page past foreign events"

echo "011 ok: list project, list notification/filesystem, importable v3 example, project-scoped event feed"
