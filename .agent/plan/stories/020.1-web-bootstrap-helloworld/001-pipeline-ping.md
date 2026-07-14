# Story 001 - Pipeline Ping

Epic: `.agent/plan/epics/020.1-web-bootstrap-helloworld.md`

## Goal

A tiny status-pill component rendered through the web TDD loop, proving the
four-role `web` pipeline and the shadcn/token design path work end to end.

## Acceptance Criteria

- `PipelinePing` renders the caller's `label` text and a shadcn `Badge` showing
  the word `ready`.
- The label element is selectable via the locator registry constant
  `locators.pipelinePing.label`; the badge via `locators.pipelinePing.badge`.
- The badge carries a semantic-token class (e.g. `bg-primary` or the badge's
  default token variant), never a raw palette class.

## Constraints

- Compose from the vendored `Badge` primitive (`@/components/ui/badge`) — no
  hand-rolled pill (DESIGN §2/§5). Style with semantic tokens only (DESIGN §3).
- Tests select only via `clients/web/src/locators.ts`; components attach ids
  only from that registry (DESIGN §8). The registry constant is SE-owned — the
  RED test imports the expected constant and the GREEN action adds it.

## Verification Gate

- `npm run test:web` green for `clients/web/src/components/PipelinePing.test.tsx`;
  `npm run typecheck:web` exits 0.

### Task T1 - PipelinePing component + component test

**Input:** `clients/web/src/components/PipelinePing.tsx`, `clients/web/src/components/PipelinePing.test.tsx`, `clients/web/src/locators.ts`

**Action - RED:** Write `PipelinePing.test.tsx` (Vitest + Testing Library):
render `<PipelinePing label="pipeline live" />`; assert the label element
(`locators.pipelinePing.label`) has text `pipeline live`, the badge element
(`locators.pipelinePing.badge`) is in the document and reads `ready`, and the
badge's className contains a semantic-token class. The test imports
`locators.pipelinePing.*` constants that do not exist yet — that missing
constant is part of the failing state.

**Action - GREEN:** Create `PipelinePing.tsx` composing the vendored `Badge`,
attaching the two locator ids; add the `pipelinePing` group (`label`, `badge`)
to `clients/web/src/locators.ts`.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
