# Story S10 — lock the `If-Match` atomicity invariant before it breaks

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decision 3)

Follow-up hardening story. No row changes, no new route, no migration.
`ROUTES.length` is unchanged.

## This is NOT a live defect — measured, not assumed

The dispatcher (`src/apps/http/app.ts:222-243`) runs a PATCH as four steps with
an `await` between each:

```ts
const before = readPresent(await readRow.run(deps, readInput)); // 1. pre-read
const ifMatch = ctx.get("if-match");
if (!ifMatch) {
  /* 428 */
}
if (ifMatch !== etagOf(before)) {
  /* 412 */
} // 2. compare
await route.run(deps, route.decode(rawInput)); // 3. write
const after = readPresent(await readRow.run(deps, readInput)); // 4. re-read
```

That reads like a classic check-then-act race. It was tested against the
committed tree (`3db820d`): ten PATCHes fired at one initiative, all carrying the
same validator, none awaited before the others were sent.

```
statuses: 200,412,412,412,412,412,412,412,412,412
final name: n0
```

Exactly one write won. **There is no lost update today**, and no user is at risk
right now.

## Why it holds, and why that is fragile

It holds by accident of implementation, not by design. `node:sqlite` is
**synchronous**, so every PATCH's `readRow.run` and `route.run` do all their work
before returning. Their `async` signatures yield only microtasks, and Node drains
the microtask queue completely before taking the next HTTP request off the
macrotask queue. So steps 1–4 of request A all finish before request B's handler
starts.

The invariant is therefore: **no PATCH path may await a macrotask.** Nothing in
the codebase states or enforces that. The first PATCH whose `run` or `readRow`
performs real async I/O — a `git` invocation, a network probe, a file read, a
child process — opens the window silently. No existing test fails when that
happens; the symptom is a lost update in production.

EPIC 024 is the near-term risk (`POST /api/repository/:id/landing`, provider
probes), and 025 puts a UI pause/resume control on `PATCH
/api/initiative/:id`, where a double-click is two in-flight PATCHes on one
validator.

## Change

### 1. The RED test — make the fragility visible

In `src/apps/http/app.test.ts`, add a PATCH row to the test fixture whose `run`
awaits a **macrotask** (`await new Promise((r) => setImmediate(r))`) before
writing. Fire two requests at it concurrently with the same valid `If-Match`.

Expected: exactly one `200`, one `412`. This test **fails today** — both return
`200` — which is the proof that the invariant is unguarded rather than enforced.

### 2. The fix — an in-process keyed mutex

`UnitOfWork.transaction<T>(fn: () => T)` (`src/storage/port.ts:37-39`) cannot be
used: it is **synchronous**, and `SqliteTransactor.run` would `COMMIT` before an
awaited write resolved. Do not reach for it here.

- new `src/apps/http/mutex.ts` — a minimal keyed async lock (a `Map<string,
Promise<void>>` chain, no dependency).
- key: `` `${route.path}:${JSON.stringify(outcome.params)}` `` — the row's path
  template plus its resolved params, so PATCHes on different targets never block
  each other and PATCHes on the same target serialise.
- acquire immediately before step 1, release in a `finally` after step 4, so a
  throw cannot strand it.

### Recorded limit

The mutex is per process. Two `serve` processes on one database would still
interleave. Out of scope, and consistent with EPIC 025's single-`serve`
assumption. The durable multi-process answer is a monotonic `version` column per
aggregate with the write issued as `UPDATE … WHERE version = ?` and zero affected
rows mapped to `412`. Recorded so the choice is deliberate; deferred because it
touches every write use case and every entity table for a race that cannot occur
while one process owns the database.

## Tests (hermetic, `node:test`)

1. **The async-dep race is refused.** As in change 1 — RED before, green after.
2. **Different targets do not serialise.** Two PATCHes on different initiative
   ids both return `200` and both writes are recorded. Guards against a global
   lock.
3. **The lock releases on failure.** A PATCH whose `run` throws returns its mapped
   error, and a following PATCH on the same id completes instead of hanging.
4. **Existing behaviour unchanged.** `428` (absent), `412` (stale) and `404`
   (unknown id — the pre-read runs first) keep their statuses and ordering.
5. `src/apps/http/mutex.ts` unit tests: sequential acquisition per key,
   independence across keys, release on rejection.

## Pass / fail

- `npm run verify` green.
- Test 1 fails before the change and passes after; tests 2–4 pass both before and
  after.
- `scripts/e2e/http-writes-proof.sh` passes unchanged — no observable
  single-request behaviour changes.

## Priority

Not urgent: nothing is broken. Land it **before** any PATCH row gains async I/O,
which realistically means before EPIC 024.
