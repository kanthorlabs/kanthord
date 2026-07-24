# Story D — `provider.failover` event type + migration 19 + exhaustion

Epic: `.agent/plan/epics/008.4-runtime-provider-failover.md`
Depends on: Story A (`reasonCode`), Story B (failover loop emits the event).

## Change

- **Event type** — `src/domain/event.ts`: add `"provider.failover"` to
  `EVENT_TYPES` (:3-27). It is distinct from the existing `"provider.retry"`
  (007.9 same-provider transient retry).
- **Migration 19** — `src/storage/sqlite/migrations.ts`, append after 008.3's
  migration 18. Rebuild `events` to admit the new type (SQLite can't ALTER a
  CHECK) — copy the migration-12 `events_new5` template (:300-319) into
  `events_new6` with **all six columns** and add `'provider.failover'` to the
  `type` CHECK list:
  ```
  {
    version: 19,
    name: "008.4-s-provider-failover-event",
    up: (db) =>
      db.exec(`
  CREATE TABLE events_new6 ( … same 6 columns … CHECK (type IN ( …all current… , 'provider.failover')) … );
  INSERT INTO events_new6 (id,type,taskId,payload,objectiveId,initiativeId) SELECT id,type,taskId,payload,objectiveId,initiativeId FROM events;
  DROP TABLE events;
  ALTER TABLE events_new6 RENAME TO events;
  `),
  },
  ```
  (Copy the exact current CHECK list from migration 12 verbatim, then append
  `,'provider.failover'`.)
- **Exhaustion contract** — `src/app/task/run-next-task.ts`: when the chain is
  exhausted by provider errors (Story B, no next provider), fail the task with a
  `task.failed` event whose `payload` carries **`reasonCode:"provider_chain_exhausted"`**
  and **`providerReasons`** = the per-provider reason codes joined (e.g.
  `"auth,provider_unavailable"`), plus a `reason` prose string. (This is the
  structured field the epic Proof asserts.)
- **Redaction** — the `provider.failover` `{from,to,reasonCode}` payload and the
  exhaustion `reason`/`providerReasons` use only ids + typed reason codes; never
  raw exception text, response bodies, headers, URLs, or credentials. The daemon
  summary (`run-daemon.ts` log) reports failover counts.

## Constraints

- Migration 19 preserves every current event row and column; only the CHECK list
  grows by one literal.
- No secret in any failover/exhaustion payload or the daemon summary.

## Verify

- Extend `src/storage/sqlite/migrations.test.ts`: `userVersion` → 19; inserting an
  `events` row with `type='provider.failover'` succeeds; an unknown type still
  throws.
- Extend `src/app/task/run-next-task.test.ts`: a `FakeRunner` returning
  `providerError` for every provider over `chain=[BAD, BAD2]` → task `failed`, a
  `provider.failover` (BAD→BAD2) event emitted, and the final `task.failed`
  payload has `reasonCode==='provider_chain_exhausted'` with `providerReasons`
  listing both codes; no secret in any payload.
- `npm run verify` exits 0.
- Proof (008.4 Proof block): delivers **PASS D1** (exhausted chain ⇒ task failed),
  **PASS D2** (no secret in exhaustion output), **PASS D3** (`task.failed` typed
  `reasonCode=provider_chain_exhausted`), and **PASS D4** (both providers
  attempted — BAD→BAD2 failover observed).
