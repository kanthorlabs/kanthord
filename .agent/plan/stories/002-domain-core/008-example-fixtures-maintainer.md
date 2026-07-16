# Story 008 - example fixtures (maintainer)

Epic: `.agent/plan/epics/002-domain-core.md` — the epic's eighth story.

Maintainer-executed: `examples/**`, `eslint.config.js`, and `README.md` fail
`scripts/lane-check.sh` for both engineer roles. No `### Task` headings on
purpose — the test-engineer scans Story files for those; this file must stay
invisible to that scan. **M1 and M2 run BEFORE the /work dispatch** — Story
007 T2's tests read these fixtures.

- [ ] **M1 — lint allowlist.**
  - Requires: none (before /work).
  - Input: `eslint.config.js` (EPIC 001 boundary lint).
  - Do: allow `src/domain/**` to import `ulid` (single-package allowlist;
    everything else stays domain + `node:*`). Confirm `src/apps/**` may
    import `yaml` (verify, don't assume).
  - Output: amended lint config.
  - Verify: `npm run lint` exits 0 once Story 001 lands; the negative
    boundary proof (EPIC 001 S2-T4) still fails on forbidden imports.

- [ ] **M2 — commit the example fixtures.**
  - Requires: none (before /work; schema locked in story 007).
  - Input: `examples/` (new directory).
  - Do: commit the three files with the exact content below.
  - Output: `examples/demo-graph.yaml`, `examples/invalid-cycle.yaml`,
    `examples/invalid-unknown-dep.yaml`.
  - Verify: files exist and byte-match the blocks below.

- [ ] **M3 — run the executable Proof.**
  - Requires: Story 007 complete (all Tasks green), M2.
  - Input: the committed fixtures + the wired CLI.
  - Do: run the script below from the repo root.
  - Output: `PROOF-OK` on stdout, exit 0.
  - Verify: the script exits 0 and prints `PROOF-OK`.

        set -e
        diff <(node src/main.ts graph check examples/demo-graph.yaml) <(printf 'design: ready\nimplement: blocked (waiting: design)\ntest: blocked (waiting: implement)\ndocs: blocked (waiting: design)\n')
        ! node src/main.ts graph check examples/invalid-cycle.yaml 2>/dev/null
        node src/main.ts graph check examples/invalid-cycle.yaml 2>&1 >/dev/null | grep -qx 'error: cycle detected: a -> b -> a'
        ! node src/main.ts graph check examples/invalid-unknown-dep.yaml 2>/dev/null
        node src/main.ts graph check examples/invalid-unknown-dep.yaml 2>&1 >/dev/null | grep -qx 'error: unknown dependency: ghost (referenced by a)'
        echo PROOF-OK

- [ ] **M4 — remove the entity sketch from README.md + repoint every
      reference to it.**
  - Requires: epic closed (`HUMAN_REVIEW: PASS` in the discussion file).
  - Input: `README.md`, `AGENTS.md`,
    `.agent/plan/epics/004-cli-work-graph.md`.
  - Do: delete the `### Abstraction` section; point the Architecture section
    at the code (`src/domain/`) and the canonical model in story 003. Keep
    the Graph tree as the high-level picture. Repoint the references that
    would dangle: `AGENTS.md` "See `README.md` for the current architecture"
    → `src/domain/` + story 003 + `docs/flowchart/`; EPIC 004's "required
    flags from the README union" → the Resource union in
    `src/domain/resource.ts` (story 003 model table). Purely historical
    mentions ("the README sketch predates that decision") may stay — they
    still read correctly after the deletion.
  - Output: README without the entity sketch; no file points at the deleted
    section; single source of truth is story 003 + code.
  - Verify: `grep -c 'interface Task' README.md` returns 0; a repo-wide
    sweep `grep -rn -i 'README' AGENTS.md .claude .opencode .agent/plan
    docs` shows no pointer to the removed Abstraction/union content
    (baseline 2026-07-16: `.claude`/`.opencode` clean; the two `AGENTS.md`
    lines and EPIC 004 line 60 are the ones this item fixes); story 003's
    canonical-model table covers everything the deleted section defined.

`examples/demo-graph.yaml`:

    tasks:
      - id: design
      - id: implement
        dependencies: [design]
      - id: test
        dependencies: [implement]
      - id: docs
        dependencies: [design]

`examples/invalid-cycle.yaml`:

    tasks:
      - id: a
        dependencies: [b]
      - id: b
        dependencies: [a]

`examples/invalid-unknown-dep.yaml`:

    tasks:
      - id: a
        dependencies: [ghost]
