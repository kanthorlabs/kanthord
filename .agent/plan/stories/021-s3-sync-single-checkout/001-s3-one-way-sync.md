# Story 001 - S3 One-Way Sync

Epic: `.agent/plan/epics/021-s3-sync-single-checkout.md`

## Goal

The markdown store replicates one-way to an S3-compatible bucket: changed files
upload, deletions propagate, an interrupted sync resumes from its cursor, and
the remote copy's integrity is verifiable — local truth is never overwritten.

## Acceptance Criteria

- A sync pass after a store mutation uploads exactly the changed/added
  **allowlisted** files (covered plan files + STATE/journal/RUNBOOK) under the
  configured prefix, each carrying its content digest in object metadata
  (PRD §6.1 — markdown is the sole thing synced; Epic 021 backup-safety
  invariants).
- A removed file's remote object moves to the `trash/<ts>/` prefix — soft
  delete, never a hard delete (Epic 021 invariant).
- A planted non-allowlisted file (SQLite, lock, temp, a stray log) never
  appears in the double's object set (allowlist asserted both directions).
- Cursor ordering: upload → verify → advance; killing a sync between upload and
  cursor advance re-uploads idempotently on rerun; only the not-yet-synced
  remainder uploads (no skipped-upload window exists by construction — Epic 021
  invariant).
- The integrity check compares the stored metadata digests against local file
  digests (never provider ETags) and reports mismatches; a remote object whose
  digest differs from both local and the manifest's last-uploaded digest is
  **reported, never downloaded** (one-way; single-writer invariant, PRD §6.1).
- S3 errors follow the SU1 taxonomy: throttling retries with backoff; auth
  failure surfaces as a typed error + escalation; sync failure never blocks
  store writes (replication is not the loop — phases.md 2A note).
- Credentials appear in no cursor/manifest file, log, event, or typed error
  (redaction sweep).

## Constraints

- The S3 client and its error shapes come from the Epic 020 SU1 findings
  (`s3-surface.md`); tests use a hand-written in-process double of that surface
  (PROFILE.md — hermetic, no network).
- Sync runs on the injectable clock (Epic 001) as a scheduled pass — no
  file-watcher (consistent with the store's no-watcher stance).
- Credentials come from custody config; they appear in no log/event (Epic 014
  redaction standard).

## Verification Gate

- `npm test` green for `src/sync/s3-sync.test.ts`.

### Task T1 - Changed-set upload + never-runtime-files

**Input:** `src/sync/s3-sync.ts`, `src/sync/s3-sync.test.ts`

**Action - RED:** Write tests: (a) after two file writes + one delete, a pass
uploads the two (digest in metadata) and soft-deletes the one to `trash/`;
(b) an unchanged store yields zero operations; (c) planted non-allowlisted
files never appear in the double's listing.

**Action - GREEN:** Implement the pass (allowlisted changed-set detection from
store state + digests, upload/soft-delete via the SU1 client surface).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Cursor resume, integrity, one-way guarantee

**Input:** `src/sync/s3-sync.ts`, `src/sync/s3-sync.test.ts`

**Action - RED:** Write tests: (a) a pass killed between upload and cursor
advance re-uploads idempotently; a pass killed earlier resumes only the
remainder; (b) the integrity check flags a corrupted remote object via metadata
digests (an ETag-only difference is not consulted); (c) an unexpected-digest
remote object is reported and the local file is untouched; (d) throttling
triggers backoff then success; auth failure escalates without blocking a
concurrent store write; (e) redaction sweep over cursor/manifest/errors.

**Action - GREEN:** Implement the ordered durable cursor, digest integrity
pass, and error handling per the SU1 taxonomy.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
