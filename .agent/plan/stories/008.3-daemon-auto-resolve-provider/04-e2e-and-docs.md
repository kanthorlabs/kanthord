# Story D — Update E2E scripts + docs

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: Story A (chain resolution), Story C (retire), Story E (login cutover).

## Change

- **E2E setup scripts** (`scripts/e2e/*`): replace project `create ai-provider` /
  `create credential`-for-AI + `--bind provider=` / `--bind cred=` usage with the
  new flow: `register ai-provider --name … --provider … --model … --value-file …`
  (008.1) + `assign ai-provider --project … --provider …` (008.2), and
  `import graph … --bind source=<repo>` only. Specifically:
  - `scripts/e2e/landing-proof.sh:28` (`create ai-provider …`) → `register` +
    `assign`; drop the `--bind provider=`/`--bind cred=` args on the `import graph`
    line.
  - any other `scripts/e2e/*.sh` running `create ai-provider` / `create credential`
    for the AI key + provider/cred binds (grep `create ai-provider`,
    `--bind provider`, `--bind cred`).
- **E2E skill** (`.claude/skills` / the `e2e` skill flow, and `scripts/e2e/README`
  if present): update the documented setup to `register` + `assign`, no
  provider/cred bind.
- **AGENTS.md**: add one line under the AI-provider/Architecture section — provider
  selection is **daemon-resolved from the project chain** (`task → initiative →
project`), not a task binding.

## Constraints

- Documentation/scripts only — no production `src/` changes here (those are
  Stories A/C/E). Keep each edited script runnable end to end.

## Verify

- Run the updated E2E happy-path script (or `scripts/e2e/landing-proof.sh`) to
  green after 008.3 Stories A–C+E land.
- `npm run verify` exits 0 (verify:handoff / lint cover script + docs hygiene).
- Proof (008.3 Proof block): no dedicated `PASS` line — this story keeps the
  end-to-end Proof runnable (the Proof itself uses `register`+`assign`+`--bind
source=` only, which this story makes the scripts match).
