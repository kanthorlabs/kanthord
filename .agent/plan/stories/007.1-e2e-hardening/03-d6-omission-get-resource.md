# Story 03 — D6: structural omission of credential values + `get resource`

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

`Credential.value` is **structurally absent** from every serialization path that
leaves the domain boundary — resource rows returned from `GetResource` /
`FindResource`, JSON output, error objects, and any future export boundary. This
is not string redaction (OAuth JSON nesting defeats exact-string redaction); the
field simply never appears in serialized form. A new `get resource --id <id>
[--json]` read command surfaces resource details without ever emitting the value.
A canary test asserts the value never leaks through these paths even if the
serializer is refactored.

The structural-omission serializer is reused by Story 9's `diagnostics export`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/app/resource/get-resource.ts  (new use case)

export type ResourceView =
  | {
      type: "repository";
      id: string;
      projectId: string;
      name: string;
      remoteUrl: string;
      branch: string;
      path: string;
      auth: import("../../domain/resource.ts").RepositoryAuth;
    }
  | {
      type: "credential";
      id: string;
      projectId: string;
      name: string;
      provider: string;
    } // NO value field — structurally omitted
  | {
      type: "notification";
      id: string;
      projectId: string;
      name: string;
      provider: string;
      destination: string;
    }
  | {
      type: "ai_provider";
      id: string;
      projectId: string;
      name: string;
      provider: string;
      model: string;
      baseUrl?: string;
      effort?: import("../../domain/resource.ts").ReasoningEffort;
    }
  | {
      type: "filesystem";
      id: string;
      projectId: string;
      name: string;
      path: string;
    };

export class GetResource {
  constructor(projectRepository: ProjectRepository);
  execute(id: string): ResourceView; // throws UnknownReferenceError when not found
}

// Serializer helper (exported for reuse by Story 9's export boundary):
export function toResourceView(resource: Resource): ResourceView;
```

```ts
// src/apps/cli/resource.ts — new handler
export function runGetResource(
  args: Record<string, unknown>,
  getResource: GetResource,
): HandlerResult;
// CLI flag: --id <id>  [--json]
// JSON: JSON.stringify(resourceView)
// Plain: one line per field, key: value — never prints the credential value
```

```ts
// Canary (in the test file):
// Given a Credential with value "CANARY_SECRET_VALUE",
// toResourceView(credential) must not JSON-stringify to a string containing
// "CANARY_SECRET_VALUE" — assert structurally (property absent), not by string scan.
```

## Constraints

- `GetResource` lives in `src/app/resource/get-resource.ts`. It imports
  `domain/resource.ts` and `storage/port.ts` only. No adapter code.
- `toResourceView` is exported from the same file for reuse by Story 9.
  It is a pure synchronous function; no I/O.
- `ResourceView` for `credential` has **no** `value` key — not `value: undefined`,
  not `value: "[REDACTED]"`. The field is structurally absent. TypeScript enforces
  this with the explicit type (no spread of the domain `Credential` object).
- `FindResource` (existing use case, `src/app/resource/find-resource.ts`) returns
  an id only — it is not changed to return a view. `GetResource` is the new
  read-by-id use case.
- `COMMANDS` gains a `"get resource"` entry in `src/apps/cli/router.ts`.
  `RouterDeps` gains `getResource: GetResource`.
- `src/composition.ts` (`buildDeps`) wires the new `GetResource` use case.
- `findResource` (the existing find-by-name path) continues to return just an id
  (no view leak). Only `GetResource.execute` calls `toResourceView`.

## Verification Gate

`node --test src/app/resource/get-resource.test.ts` green;
`node --test src/apps/cli/resource.test.ts` (the canary assertion) green;
`npm run typecheck` exit 0; `npm run lint` clean.

---

### Task T1 — `toResourceView` + `GetResource` use case

**Requires:** Story 01 T1 (Repository shape has `remoteUrl` + `auth`).

**Input:** `src/app/resource/get-resource.ts` (new),
`src/app/resource/get-resource.test.ts` (new),
`src/domain/resource.ts`, `src/storage/port.ts`.

**Action — RED:** tests: (a) `toResourceView` called with a `Credential`
`{ id, projectId, type: "credential", name: "k1", provider: "anthropic", value: "CANARY_SECRET_VALUE" }`
returns an object whose `JSON.stringify` output does NOT contain
`"CANARY_SECRET_VALUE"` (structural check — also assert `"value" in view === false`);
(b) `toResourceView` of a `Repository` returns a view with `remoteUrl` and `auth`,
no `organization`; (c) `GetResource.execute` with a known id returns the view
via `toResourceView`; (d) `GetResource.execute` with an unknown id throws
`UnknownReferenceError`. Fails today: `GetResource` does not exist; `toResourceView`
does not exist.

**Action — GREEN:** create `src/app/resource/get-resource.ts`. Implement
`toResourceView`: a switch on `resource.type`; for `"credential"`, explicitly
construct `{ type, id, projectId, name, provider }` with no `value` key. For
all other types copy the full shape. Implement `GetResource.execute`: look up
resource by id (via `projectRepository.getResource` or equivalent lookup);
throw `UnknownReferenceError` if absent; return `toResourceView(resource)`.

**Action — REFACTOR:** none.

**Output:** `toResourceView` structurally omits `value`; `GetResource` is the
new read-by-id use case.

**Verify:** `node --test src/app/resource/get-resource.test.ts` green;
`npm run typecheck` 0.

---

### Task T2 — CLI: `get resource --id <id> [--json]` + canary handler test

**Requires:** T1.

**Input:** `src/apps/cli/resource.ts`, `src/apps/cli/router.ts`,
`src/apps/cli/resource.test.ts`.

**Action — RED:** tests: (a) `runGetResource({ id: credId }, getResource)`
returns a `HandlerResult` whose `stdout.join("")` does NOT contain the credential
value (canary string `"CANARY_SECRET_VALUE"`); (b) plain-text output for a
`Repository` includes `remoteUrl` in stdout; (c) `--json` flag returns valid
JSON whose `.type === "ai_provider"` and no `value` key; (d) unknown id returns
exitCode 1. Fails today: `runGetResource` does not exist; `"get resource"` is
not in `COMMANDS`.

**Action — GREEN:** add `runGetResource` to `src/apps/cli/resource.ts`. Format
plain output as `key: value` lines (one per field; omit undefined optional
fields). For JSON: `JSON.stringify(view, null, 2)`. Add `"get resource"` to
`COMMANDS` in `router.ts` with `parse: { id: { type: "string" }, json: { type:
"boolean" } }`. Add `getResource: GetResource` to `RouterDeps`.

**Action — REFACTOR:** none.

**Output:** `get resource --id <id>` is a new CLI command; credential value never
in output.

**Verify:** `node --test src/apps/cli/resource.test.ts` green (including canary);
`npm run typecheck` 0; `npm run lint` clean.

---

### Task T3 — wire `GetResource` in `composition.ts` + update `buildDeps`

**Requires:** T1, T2.

**Input:** `src/composition.ts`.

**Action — RED:** a smoke test (or the existing integration test) that calls
`dispatch(["get", "resource", "--id", credId], deps)` on a real `buildDeps`
result returns exitCode 0 and stdout does not contain the credential value.
Fails today: `buildDeps` does not export `getResource`.

**Action — GREEN:** import `GetResource` in `src/composition.ts`. Construct
`const getResource = new GetResource(projectRepository)` and include it in the
returned `RouterDeps` object.

**Action — REFACTOR:** none.

**Output:** `buildDeps` wires `getResource`; the CLI dispatch works end-to-end.

**Verify:** smoke test green; `npm run verify` green.
