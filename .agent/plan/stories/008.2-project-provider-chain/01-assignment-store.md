# Story A — Ordered project→provider assignment store

Epic: `.agent/plan/epics/008.2-project-provider-chain.md`
Depends on: EPIC 008.1 (`ai_providers` table, `AiProviderRegistry`).

## Change

- **Migration 17** — `src/storage/sqlite/migrations.ts`: append after 008.1's
  migration 16:
  ```
  {
    version: 17,
    name: "008.2-s-project-ai-providers",
    up: (db) =>
      db.exec(`
  CREATE TABLE project_ai_providers (
    projectId  TEXT NOT NULL REFERENCES projects(id),
    providerId TEXT NOT NULL REFERENCES ai_providers(id),
    rank       INTEGER NOT NULL,
    PRIMARY KEY (projectId, providerId),
    UNIQUE (projectId, rank)
  );
  `),
  },
  ```
  `PRIMARY KEY (projectId, providerId)` forbids duplicate assignment;
  `UNIQUE (projectId, rank)` makes the order **total** (no rank ties).
- **Port** — `src/storage/port.ts`, extend `AiProviderRegistry` (from 008.1):
  ```
  assign(projectId: string, providerId: string, rank: number): void;
  unassign(projectId: string, providerId: string): void;
  listAssigned(projectId: string): GlobalAiProvider[];   // strict rank order
  maxRank(projectId: string): number | undefined;         // for append
  shiftRanksFrom(projectId: string, rank: number): void;  // +1 to make room
  compactRanks(projectId: string): void;                  // close gaps 0..n-1
  getAssignment(projectId: string, providerId: string): { rank: number } | undefined;
  listProjectsAssigning(providerId: string): string[];    // for remove cascade
  ```
- **Adapter** — `src/storage/sqlite/ai-provider-registry.ts` (from 008.1),
  implement the new methods:
  - `assign`: `INSERT INTO project_ai_providers (projectId,providerId,rank) VALUES (?,?,?)`.
  - `unassign`: `DELETE FROM project_ai_providers WHERE projectId=? AND providerId=?`.
  - `listAssigned`: `SELECT p.* FROM ai_providers p JOIN project_ai_providers a ON a.providerId=p.id WHERE a.projectId=? ORDER BY a.rank ASC` → `GlobalAiProvider[]`.
  - `maxRank`: `SELECT MAX(rank) …`.
  - `shiftRanksFrom`: `UPDATE project_ai_providers SET rank = rank + 1 WHERE projectId=? AND rank >= ?` (apply within a transaction from the caller; SQLite applies the whole UPDATE atomically).
  - `compactRanks`: re-number rows to `0..n-1` by current rank order (SELECT ids ordered by rank, then UPDATE each to its index).
  - `getAssignment` / `listProjectsAssigning`: straightforward SELECTs.

## Constraints

- `node:sqlite` only; reuse the single shared `db`.
- Storage-only: no use case, no CLI here (Stories 02/04/05).
- Rank uniqueness per project is enforced by the schema `UNIQUE(projectId,rank)`;
  the shift/compact helpers keep it satisfiable — callers wrap multi-step rank
  edits in `unitOfWork.transaction`.

## Verify

- Extend `src/storage/sqlite/ai-provider-registry.test.ts`:
  - `assign` two providers at ranks 0,1 → `listAssigned` returns them in rank
    order; `maxRank` returns 1.
  - duplicate `assign` (same projectId,providerId) → throws (PRIMARY KEY).
  - two assigns with the same rank → throws (`UNIQUE(projectId,rank)`).
  - `shiftRanksFrom(p,0)` then insert at 0 keeps order total; `compactRanks`
    turns ranks {0,2,5} into {0,1,2} preserving order.
  - `unassign` removes one; `getAssignment` → undefined after.
  - `listProjectsAssigning(providerId)` returns every project assigning it.
- Extend `src/storage/sqlite/migrations.test.ts`: `userVersion` → 17;
  `project_ai_providers` columns `["projectId","providerId","rank"]` added to the
  columns/tables asserts; a `UNIQUE` violation test via `assert.throws`.
- `npm run verify` exits 0.
- Proof: no standalone `PASS` line — substrate for Stories 02–05.
