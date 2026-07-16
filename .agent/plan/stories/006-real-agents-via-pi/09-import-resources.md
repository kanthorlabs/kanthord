# Story 09 — `import resource <file.yaml>`

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

Batch resource creation from a YAML declaration — the same construction
logic as `create`, all-or-nothing, DB stays the single authority. Off the
Proof critical path; /work schedules it after stories 01–08.

## Acceptance Criteria

- Domain function `buildResource(input): Resource` extracted (pure
  construction + per-variant field validation, including the amended
  story-01 shapes); `AddResource` delegates to it (no
  use-case-calls-use-case — shared logic moves down into `domain/`).
- `ImportResources.execute({ projectId, entries })`: builds + persists
  every entry inside ONE UnitOfWork transaction; any invalid entry
  (unknown type, missing field, duplicate name) aborts the whole import
  with a named error carrying the entry's index and name.
- CLI `import resource <path>`: the handler reads the file and parses YAML
  (`yaml` dep, already installed); shape
  `{ project: <ref>, resources: [ { type, name, <verbatim vendor
  fields> } ] }` — field names are the exact domain names (`value`,
  `baseUrl`, `organization`, `path`, `branch`; exact-entity-names rule);
  success → stdout one ULID per created resource in file order, stderr
  `imported N resources`; missing file / parse error / invalid entry →
  exit 1 one line.

## Constraints

- File reading + YAML parsing live in the CLI handler (apps parse input);
  the use case receives structured entries.
- A YAML file may contain credential `value`s — the import path applies
  the same "never echo secrets" rule: errors name entries, never values.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — `buildResource` domain extraction

**Requires:** S01-T1.

**Input:** `src/domain/resource.ts` (+ test),
`src/app/resource/add-resource.ts`.

**Action — RED:** tests: `buildResource` builds each of the five variants
from plain input; a missing vendor field → named validation error; an
unknown type → named error. Fails today: function absent.

**Action — GREEN:** implement; **REFACTOR:** `AddResource` delegates to it
(its tests staying green is the proof of the extraction).

**Output:** one shared construction path for `create` and `import`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — ImportResources use case

**Requires:** T1; EPIC 005 S02 (UnitOfWork).

**Input:** `src/app/resource/import-resources.ts` (+ test).

**Action — RED:** hermetic tests with fakes: (a) 3 valid entries → 3
ULIDs, all persisted; (b) entry 2 duplicate name → error names index 2 +
the name, entry 1 NOT persisted (transaction rolled back); (c) unknown
project → `UnknownReferenceError`. Fails today: module absent.

**Action — GREEN:** implement per the AC.

**Action — REFACTOR:** none.

**Output:** transactional batch import.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — CLI handler

**Requires:** T2; EPIC 004 S01 (command table).

**Input:** `src/apps/cli/import.ts` (new, + test); COMMANDS registration.

**Action — RED:** handler tests: (a) a valid file → exit 0, one ULID per
line, stderr `imported 3 resources`; (b) missing file → exit 1 one line;
(c) malformed YAML → exit 1 one line; (d) an entry with a wrong key (e.g.
`secret_ref`) → exit 1 naming the entry index, output free of any `value`
content. Fails today: module absent.

**Action — GREEN:** implement (`import resource <path>` — verb-first) +
register.

**Action — REFACTOR:** none.

**Output:** `import resource kanthord.yaml` works end to end.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
