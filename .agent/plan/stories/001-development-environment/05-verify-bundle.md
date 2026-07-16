# Story 5 — Verify bundle

**Acceptance:** one command runs all gates + prints the epic Proof output.

### Task S5-T1 — `verify` script + exact Proof (maintainer-config)

**Pre-requirements.** S2-T3 (`lint` script exists); S3-T4 (the program runs
end to end). Last task of the epic — it aggregates everything.

**Input.** `package.json` scripts; the existing gates (`typecheck`, `test`,
`verify:handoff`, `lint`); the locked output contract (index.md). Do **not**
add stderr filtering — the `node:sqlite` `ExperimentalWarning` is acceptable
(exit 0 + stdout is the contract).

**Action.** Add to `package.json` scripts:

```json
"verify": "npm run typecheck && npm test && npm run verify:handoff && npm run lint && node src/main.ts status"
```

**Output.** `npm run verify` — the one-command answer to "is the repo
healthy?": all four gates plus the Proof output.

**Verify.** Two parts.

1. `npm run verify` → exit 0 and the Proof lines appear at the end.
2. The exact epic Proof (copy-paste; runs from a clean checkout):

```bash
# 1. clean-checkout proof — fresh temp DB proves init from nothing
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts status
# expected stdout, exit 0 (stderr may carry ExperimentalWarning — OK):
#   db: <value of $KANTHORD_DB>
#   schema: 1
#   journal_mode: wal
#   tasks: 0

# 2. default-path proof — confirms .data default + auto dir creation
unset KANTHORD_DB
rm -f .data/kanthord.db
node src/main.ts status
# expected stdout, exit 0:
#   db: .data/kanthord.db
#   schema: 1
#   journal_mode: wal
#   tasks: 0
```
