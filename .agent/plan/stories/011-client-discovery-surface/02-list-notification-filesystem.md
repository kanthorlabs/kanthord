# Story 2 — `list notification` / `list filesystem`

Epic: `.agent/plan/epics/011-client-discovery-surface.md`
Depends on: Story 1 (it repairs the `architecture.test.ts` counters this story
bumps again).

## Change

1. `src/apps/cli/commands/list/resource.ts` — add two thin named exports beside
   `buildListCredentialCommand` (`resource.ts:43-45`) and
   `buildListRepositoryCommand` (`resource.ts:81-83`), reusing the existing
   module-private factory `buildListResourceCommand(name, type, deps, io)`
   (`resource.ts:13-41`) **unchanged**:

   ```ts
   export function buildListNotificationCommand(
     deps: CliDeps,
     io: CliIo,
   ): Command {
     return buildListResourceCommand("notification", "notification", deps, io);
   }

   export function buildListFilesystemCommand(
     deps: CliDeps,
     io: CliIo,
   ): Command {
     return buildListResourceCommand("filesystem", "filesystem", deps, io);
   }
   ```

   `"notification"` and `"filesystem"` are already members of `ResourceType`
   (`src/apps/cli/resource.ts:16-17`), and `ListResources`
   (`src/app/resource/list-resources.ts:16-23`) is already generic over the
   type and already maps through `toResourceView`
   (`src/app/resource/resource-view.ts:61-109`). **No app-layer, port, or
   composition change is needed.**

2. `src/apps/cli/commands/list.ts` — extend the existing named import block
   (`list.ts:10-14`) with the two new builders and add
   `command.addCommand(buildListNotificationCommand(deps, io));` then
   `command.addCommand(buildListFilesystemCommand(deps, io));` immediately after
   `buildListRepositoryCommand` (`list.ts:32`).

3. `src/apps/cli/architecture.test.ts` — `EXPECTED_LEAF_COUNT`
   (`architecture.test.ts:31`): `69` → `71`. **`EXPECTED_LEAF_FILE_COUNT` stays
   at `66`** — both builders live in the existing `commands/list/resource.ts`,
   so no new file appears under `commands/*/`.

## Constraints

- Do not create `commands/list/notification.ts` or
  `commands/list/filesystem.ts`; the epic pins these as builders inside
  `resource.ts`.
- Do not modify `buildListResourceCommand`, `runListResources`
  (`src/apps/cli/resource.ts:263-278`), `ListResources`, or `toResourceView`.
- `toResourceView` builds each view field-by-field with no spread — that is the
  no-secret-leak mechanism. Do not replace it with a spread.

## Verify

- `node --test src/apps/cli/commands/read.test.ts` — three new tests, same
  `capture()` harness and deps-cast convention as
  `read.test.ts:542-585`:
  - `list notification --project project-1 --json` → the fake's `execute`
    receives exactly `{ projectId: "project-1", type: "notification" }`, and
    `cap.out` deep-equals
    `['[{"type":"notification","id":"notif-1","name":"ops","provider":"slack","destination":"#ops"}]\n']`;
  - `list filesystem --project project-1 --json` → `execute` receives exactly
    `{ projectId: "project-1", type: "filesystem" }`, and `cap.out`
    deep-equals `['[{"type":"filesystem","id":"fs-1","name":"scratch","path":"/w"}]\n']`;
  - **no-secret-leak (non-vacuous)**: build a `ListResources` **real instance**
    (`new ListResources(fakeProjectRepository)`) whose
    `listResourcesByProject` returns
    `{ type: "credential", id: "cred-1", projectId: "project-1", name: "gh", provider: "github", value: "CANARY_SECRET_VALUE" }`,
    run `list credential --project project-1 --json`, and assert
    `cap.out.join("").includes("CANARY_SECRET_VALUE") === false` **and**
    `JSON.parse(...)[0].value === undefined`. This replaces the currently
    vacuous canary at `read.test.ts:545,578-582` (the existing fake row has no
    `value` field to leak) — keep that older test, add this one alongside it.
- `node --test src/app/resource/list-resources.test.ts` — two new cases:
  `type: "notification"` and `type: "filesystem"` are forwarded verbatim to
  `listResourcesByProject(projectId, type)` and the results are mapped through
  `toResourceView` (assert the returned notification view has exactly the keys
  `type, id, projectId, name, provider, destination`, and the filesystem view
  exactly `type, id, projectId, name, path`).
- `node --test src/apps/cli/architecture.test.ts` — passes with 66 / 71.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/client-discovery-proof.sh` Phase **B** — the
  `B ok: notification + filesystem list, project-scoped, no secret leak` line
  (`client-discovery-proof.sh:32-50`).
