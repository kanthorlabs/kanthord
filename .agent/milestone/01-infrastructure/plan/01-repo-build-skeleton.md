# 01 Repo & Build Skeleton

Goal:             Turn the flat hello-world skeleton into a TypeScript workspace,
                  proven by one real cross-package import, behind a single green
                  `typecheck` + `test` gate.

Decision anchors: B1 (SEA is a real target → no native deps), §3 Tech Stack
                  (Node.js 24+, TypeScript, `node:test`), §"Repository Structure"
                  (`packages/* + apps/* + proto/` — the binding layout contract).

ACs:
- From the repo root, `npm run typecheck` exits 0 and `npm test` exits 0 — both
  stay green after the layout change.
- A symbol exported from `packages/core` is imported and used by `apps/daemon`,
  and that cross-package import **type-checks** and runs under `node:test`. This
  is the acceptance test for "the workspace works": without it `typecheck` can
  pass while package resolution / ESM / workspace scripts are silently broken.
  The existing `greet` skeleton is moved across this boundary (or the smallest
  exported stub is added) rather than scaffolding throwaway code.
- The declared Node engine is **>= 24**, matching both plan §3 and the existing
  `Containerfile` (`node:24-slim`). The bump *aligns* the repo with the sandbox;
  it does not introduce a new runtime.
- `package.json` stays ESM (`"type": "module"`); the test harness stays
  `node --test` with no test-framework dependency added.
- Only the two homes proven above (`packages/core`, `apps/daemon`) are created
  now. The full target layout already lives in `01-plan.md` §"Repository
  Structure"; later epics create their own homes when they land — **no empty
  speculative dirs**.

Constraints:
- No native `.node` modules anywhere in the dependency tree — pure JS/TS only, so
  SEA and arm64-dev / amd64-VPS cross-arch stay trivial (D2, B1). This is a
  standing invariant; it has no deps to bite yet, so epic 01 adds no check for it
  (the guard belongs in the first epic that adds a dependency).
- Test harness is `node:test` + `tsc --noEmit`; do not add Jest/Vitest/etc.
  (B1 "no deps" + matches the committed hello-world harness).
- Workspace tooling (npm workspaces vs other) is the engineer's choice — prefer a
  platform built-in over a new tool. Not mandated by a decision → not an AC.

Spike?:           none — routine scaffolding; trips no spike-gate trigger (unknown
                  external API / OS boundary / pinned-dep surface / atomicity).

Verification:     `npm run typecheck && npm test` exit 0 from the repo root, with
                  the `apps/daemon` → `packages/core` import in the compiled +
                  tested set.

Dependencies:     none. Builds on the committed hello-world skeleton (`9be327f`).
                  Node-version cross-check: bumping the engine to `>= 24` must
                  also update the stragglers still naming `>= 22.19.0` —
                  `package-lock.json`, `.claude/agents/{test,software,reviewer}-
                  engineer.md`, and `.agent/tdd/PROFILE.md` — so the pipeline
                  docs stay consistent. (`Containerfile` is already `node:24`.)

Findings out:     none.
