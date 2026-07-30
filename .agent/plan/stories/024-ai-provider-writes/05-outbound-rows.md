# Story S5 — the two outbound rows: `probe` and `completion`

Epic: `.agent/plan/epics/024-ai-provider-writes.md` (decision 6)
Depends on: Story S1 (`timeoutMs` on both use cases, `secretOf` +
`ProviderCallFailedError` on `TestAiProvider`, the `probe` and `completion`
segments, the `502` status).

Lands 2 rows. `ROUTES.length` 70 → 72 — the last rows of the epic. These are the
ONLY two rows in the whole HTTP surface that make a real outbound call.

## Change

**1. `src/apps/http/views/probe.ts`** — new view module, mirroring
`views/conflict.ts:1-24`:

```
import type { ProviderProbeOutcome } from "../../../app/project/probe-ai-provider.ts";

export interface ProbeDtoView {
  readonly id: string;
  readonly status: "ok" | "failed";
  readonly detail: string;
  readonly [key: string]: unknown;
}

export function probeView(result: ProviderProbeOutcome): ProbeDtoView {
  return { id: result.resourceId, status: result.status, detail: result.detail };
}
```

Note the rename: the use case's field is `resourceId`
(`probe-ai-provider.ts:25`), the wire field is `id`. Three keys, literal.

**2. `src/apps/http/views/completion.ts`** — new view module. `TestAiProvider`
returns a bare `string`, so the view takes the reply plus the echoed prompt and id:

```
export interface CompletionDtoView {
  readonly id: string;
  readonly prompt: string;
  readonly reply: string;
  readonly [key: string]: unknown;
}
```

Because `run` must return everything `present` needs and `TestAiProvider` returns
only the reply, the row's `Output` is `{id, prompt, reply}` assembled in `run`
from its own input plus the awaited reply. That is the ONE permitted shape of
assembly in `run` — no branching, no validation, no second use-case call.

**3. `src/apps/http/routes.ts`** — append two rows:

```
id: "ai-provider.probe.create", method: "POST",
path: "/api/ai-provider/:id/probe",
successStatus: 200, kind: "json", cliCommands: []
decode: ({ params }) => ({
  providerId: requirePathParam(params, "id"),
  timeoutMs: 30000,
})
run:     async (deps, i) => deps.probeAiProvider.execute(i.providerId, { timeoutMs: i.timeoutMs })
present: (result) => probeView(result)
```

```
id: "ai-provider.completion.create", method: "POST",
path: "/api/ai-provider/:id/completion",
successStatus: 200, kind: "json", cliCommands: ["test ai-provider"]
decode: ({ params, body }) => ({
  id: requirePathParam(params, "id"),
  prompt: optionalBodyString(body, "prompt") ?? "What is today's datetime?",
  timeoutMs: 30000,
})
run:     async (deps, i) => ({
  id: i.id,
  prompt: i.prompt,
  reply: await deps.testAiProvider.execute({ id: i.id, prompt: i.prompt }, { timeoutMs: i.timeoutMs }),
})
present: (result) => completionView(result)
```

`timeoutMs: 30000` is bound **literally in `decode`**, never read from the body or
the query. No client may hold a server request open longer.

The default prompt is the CLI's exact string
(`src/apps/cli/commands/test/ai-provider.ts` `--prompt` default), so
`test ai-provider` with no flag has a true HTTP twin — which is why the epic
claims that leaf in full.

**4. `cliCommands` differ, deliberately.** `…/probe` claims NO leaf (`[]`) — it is
a new capability the readiness screen needs, not a CLI verb.
`RouteMeta.cliCommands` explicitly "May be empty" (`routes.ts:48`).
`…/completion` claims `test ai-provider`.

**5. Wiring, all in this story:**

- `src/apps/http/deps.ts` — `import type { ProbeAiProvider } from "../../app/project/probe-ai-provider.ts";`
  and `import type { TestAiProvider } from "../../app/ai-provider/test-ai-provider.ts";`;
  fields `readonly probeAiProvider: ProbeAiProvider;` and
  `readonly testAiProvider: TestAiProvider;`.
- `src/apps/cli/commands/serve.ts` — **`probeAiProvider: deps.providerProbe,`**
  (the `CliDeps` name is `providerProbe`, `src/apps/cli/deps.ts:250` — the names
  DIFFER) and `testAiProvider: deps.testAiProvider,`.
- `src/composition.ts` — **no change**; S1 already made the only edit.

**6. `src/apps/http/routes.test.ts`** — row count **72**; add
`"ai-provider.probe.create"` and `"ai-provider.completion.create"` to the
expected-id array.

## Constraints

- **The probe never answers `5xx` for a dead provider.** `ProbeAiProvider.execute`
  never throws (`probe-ai-provider.ts:53-59` and S1's timeout path), so a dead
  endpoint is `200 {"status":"failed"}`. Do not add a try/catch in `run` and do not
  map a probe failure to an error code.
- **The completion answers `502 provider_call_failed`** for a dead provider,
  because `TestAiProvider` throws (S1). Do not catch it in `run`; the registry
  maps it, with a FIXED message.
- **The probe must never carry the model's words.** Its detail is
  `ProbeAiProvider`'s fixed success string or its redacted, first-line,
  300-char-capped failure detail. Do not add the reply to `views/probe.ts`.
- **The completion reply is returned verbatim and uncapped** — that is the leaf's
  whole point (epic decision 6, with the megabyte-response cost recorded). Do not
  truncate, do not sanitise, and do NOT log it.
- **Neither row accepts a caller-supplied timeout.** `timeoutMs` is a literal in
  `decode`. Do not read it from the body or query, and do not make it optional.
- `:id` is the PARENT provider in both paths and the segment names the created
  child — the ordinary `POST /parent/:id/child` form, confirmed in scope by
  Ulrich (2026-07-30) and identical to 023's nine transition rows. Do not reshape
  either path.
- Both rows are `200` `kind:"json"`, so 021's dispatcher puts an `ETag` on both.
  That is correct and asserted; do not suppress it.
- An unknown provider is `404 unknown_reference` on both. For the probe that comes
  from the registry lookup inside the tester; assert it with a fake rather than
  assuming a code path.
- No `If-Match`, no `readRow`, no `location` (neither answers `201`).
- Leave `mock-openai-completions.mjs` alone — it logs nothing, and no assertion in
  this epic inspects its output.

## Verify

- `node --test src/apps/http/views/probe.test.ts` — new file, the
  `views/conflict.test.ts:7-29` leak pattern: an outcome carrying
  `extra: "leak-me"` and a `value: "sk-LEAK"` cast
  `as unknown as ProviderProbeOutcome` yields exactly
  `["detail","id","status"]` from `Object.keys().sort()`, and `resourceId` is
  mapped to `id`.
- `node --test src/apps/http/views/completion.test.ts` — new file, same pattern:
  exactly `["id","prompt","reply"]`; a 5000-character reply survives intact
  (proves no cap); a reply with newlines survives intact (proves no first-line
  split).
- `node --test src/apps/http/routes.provider.test.ts` — add:
  - **probe `decode`** → exactly `{providerId:"aip-1", timeoutMs:30000}`; a blank
    `:id` → `400 invalid_input`; a body carrying `{"timeoutMs":1}` is IGNORED (the
    decoded value stays `30000`);
  - `run` calls `probeAiProvider.execute` once with
    `("aip-1", {timeoutMs:30000})` — assert BOTH arguments;
  - a fake returning `{resourceId:"aip-1", status:"ok", detail:"…"}` → `200`, DTO
    keys exactly `["detail","id","status"]`, and an `etag` header present;
  - a fake returning `{status:"failed", detail:"connect ECONNREFUSED"}` →
    **`200`, not 500**, with `status:"failed"`;
  - a fake whose detail contains a secret-looking string still returns it as-is
    (redaction is the use case's job, tested in S1) — this test only proves the
    row does not add its own;
  - **completion `decode`** with `{"prompt":"hi"}` → exactly
    `{id:"aip-1", prompt:"hi", timeoutMs:30000}`; with `{}` → the CLI default
    prompt; with `{"prompt":"   "}` → `400 invalid_input` if
    `optionalBodyString` trims-and-rejects blank (assert the actual behaviour, and
    raise an `OPEN:` blocker if it differs from 021's `requireBodyString`);
  - `run` calls `testAiProvider.execute` once with
    `({id:"aip-1", prompt:"hi"}, {timeoutMs:30000})` — assert BOTH arguments;
  - a fake resolving `"DATETIME-OK"` → `200`, DTO exactly
    `{id, prompt, reply}` with `reply === "DATETIME-OK"` and the prompt echoed;
  - a fake rejecting with `ProviderCallFailedError` → **`502
provider_call_failed`** whose response message is the FIXED registry text and
    contains neither the provider's error text nor a secret;
  - a fake rejecting with `UnknownReferenceError` → `404 unknown_reference` on
    both rows;
  - both rows with `Content-Type: text/plain` → `415`; with
    `Origin: http://127.0.0.1:1` → `403 origin_not_allowed`;
  - `GET /api/ai-provider/aip-1/probe` → `405`.
- `node --test src/apps/http/routes.test.ts` — row count **72**; both ids
  present; `cliCommands` is `[]` on the probe row and `["test ai-provider"]` on
  the completion row; `present` is set on both (neither is `204`, neither sets
  `readRow`); `location` is unset on both.
- `npm run verify` exits 0.
- Proof: unblocks phase **H** of `scripts/e2e/http-provider-writes-proof.sh` —
  the live probe, the live completion returning the mock's `DATETIME-OK` marker,
  and the post-kill divergence (probe `200/failed` versus completion `502`).
