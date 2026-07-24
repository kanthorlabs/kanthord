# Story A — emit `repository.published` from PublishRepository

Epic: `.agent/plan/epics/007.15-e2e-delivery-lifecycle.md`

## Change

1. **Add the event type.** `src/domain/event.ts` — add the string literal
   `"repository.published"` to the `EVENT_TYPES` array (lines 3-28). Place it
   immediately after `"initiative.delivered"` (line 26). No other change to
   `event.ts` (the `newEvent` factory and `Event` interface already accept any
   `EventType`).

2. **Inject the event feed + unit of work into `PublishRepository`.**
   `src/app/repository/publish-repository.ts`:
   - Add `import type { EventFeed } from "../../events/port.ts";` and
     `import { newEvent } from "../../domain/event.ts";` (this file currently
     imports only errors + the resource/publication/publisher ports, lines
     10-15).
   - Add a UnitOfWork param of the same type `ApproveObjective` takes as its 4th
     constructor arg (find it via `src/app/objective/approve-objective.ts` +
     `composition.ts:617`; import the type with `import type`).
   - Extend the constructor (lines 41-56) with two new params **appended after
     the existing five**: `feed: EventFeed` and `unitOfWork: <UnitOfWork>`;
     assign to private fields `#feed`, `#uow`.

3. **Emit on a real publish transition, atomically.** In `execute` (lines
   58-102), the success branch currently is (lines 86-90):

   ```ts
   this.#publicationRepository.setPublication(repositoryId, branch, {
     state: "published",
     remoteOID: result.remoteOID,
   });
   return { kind: "published", repositoryId, remoteOID: result.remoteOID };
   ```

   Replace so that: read the prior record once **before** the publish call
   (there is already a read of `getPublication(...)` at lines 74-76 for
   `expectedRemoteOID`; reuse or re-read the full `PublicationRecord`). After a
   successful `publisher.publish`, wrap the `setPublication` **and** the event
   append in a single `this.#uow.transaction(() => { ... })`, and append the
   event **only when the publication actually transitions** — i.e. only if the
   prior record is absent, OR `prior.state !== "published"`, OR
   `prior.remoteOID !== result.remoteOID`:

   ```ts
   this.#uow.transaction(() => {
     this.#publicationRepository.setPublication(repositoryId, branch, {
       state: "published",
       remoteOID: result.remoteOID,
     });
     if (
       !prior ||
       prior.state !== "published" ||
       prior.remoteOID !== result.remoteOID
     ) {
       this.#feed.append(
         newEvent("repository.published", {
           payload: { repositoryId, branch, remoteOID: result.remoteOID },
         }),
       );
     }
   });
   return { kind: "published", repositoryId, remoteOID: result.remoteOID };
   ```

   Do NOT emit on the `diverged` or `failed` branches (lines 92-100) — leave
   them unchanged.

4. **Wire it in composition.** `src/composition.ts:471-477` — pass the existing
   shared `events` (created at `composition.ts:155`) and the existing
   `unitOfWork` (the same instance injected into `approveObjective` at
   `composition.ts:617`) as the two new trailing args to
   `new PublishRepository(...)`.

## Constraints

- Surgical: only the success/`published` branch changes; `diverged`/`failed`
  paths and the divergence/no-force-retry behavior are untouched.
- Idempotent: a repeated publish of the same `remoteOID` that is already
  `published` MUST NOT append a second `repository.published` event.
- `payload` values are strings only (`Event.payload` is `Record<string,string>`).
- Do not reorder the first five constructor params (other call sites / tests
  depend on their order) — append the two new ones.

## Verify

- `src/app/repository/publish-repository.test.ts` — extend the existing hermetic
  fakes (no real sqlite/git; see header lines 1-7 and fakes at lines 24-82).
  Add a fake `EventFeed` (class with `append(event)` recording appended events,
  as in `src/app/objective/approve-objective.test.ts:25`) and a fake UnitOfWork
  whose `transaction(fn)` just calls `fn()`. Update the existing
  `new PublishRepository(...)` construction (lines 109-115) to pass them. Add
  tests asserting:
  - a first successful publish appends exactly one event of type
    `repository.published` whose `payload` has `repositoryId`, `branch`, and
    `remoteOID === result.remoteOID`;
  - a second publish with the same `remoteOID` when the seeded publication is
    already `{state:"published", remoteOID:<same>}` appends **no** event;
  - the `diverged` test (existing, lines ~150) and the `failed`/error tests
    append **no** event (regression guard).
- `npm run verify` exits 0.
- Proof: delivers the EPIC Proof line asserting the feed contains exactly one
  `"repository.published"` event.
