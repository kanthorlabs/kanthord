# Story C — Pure provider-chain resolver

Epic: `.agent/plan/epics/008.2-project-provider-chain.md`
Depends on: EPIC 008.1 (`GlobalAiProvider` shape).

## Change

- **New pure function** — `src/app/ai-provider/resolve-provider-chain.ts`
  (zero-I/O; template `src/app/graph/binding-resolver.ts:37-61`):
  ```
  export function resolveProviderChain(
    assignedInRankOrder: GlobalAiProvider[],
    defaultProvider: GlobalAiProvider | undefined,
  ): GlobalAiProvider[] {
    const active = assignedInRankOrder.filter((p) => p.state === "active");
    const seen = new Set(active.map((p) => p.id));
    const out = [...active];
    if (defaultProvider && defaultProvider.state === "active" && !seen.has(defaultProvider.id)) {
      out.push(defaultProvider);
    }
    return out;
  }
  ```
  Rules pinned: (1) assigned providers in rank order; (2) logged-out excluded;
  (3) default appended **iff** its id is absent (first-wins dedup) **and** it is
  active; (4) empty when nothing active.

## Constraints

- Zero I/O — no imports from `apps/`, `storage/`, or a repository. Inputs are
  already-loaded records (the caller — Story 04 / the 008.3 daemon — does the I/O).
- Determinism: order is exactly `[...active-assigned-in-rank, default?]`; no
  sorting beyond the caller-supplied rank order.

## Verify

- New `src/app/ai-provider/resolve-provider-chain.test.ts` (no fakes needed —
  pure function; `node:test` + `node:assert/strict`):
  - `[P3,P2]` (active) + default `P1` (absent) → `[P3,P2,P1]`;
  - default already in the list → not duplicated (`[P3,P2]` when default is P3);
  - a `logged_out` assigned provider is dropped;
  - a `logged_out` default is not appended;
  - no assignments + active default → `[default]`;
  - nothing active → `[]`.
- `npm run verify` exits 0.
- Proof (008.2 Proof block): delivers the logic behind **PASS A/B/C** (append),
  **PASS C-dedup** (no duplicate), **PASS D** (default-only), **PASS D-loggedout**
  (exclusion) — surfaced through Story 04's `list --project` command.
