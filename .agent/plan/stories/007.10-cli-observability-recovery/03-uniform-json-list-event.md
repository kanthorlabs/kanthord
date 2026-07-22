# Story C — uniform `--json` for `list event` (F4)

Epic: `.agent/plan/epics/007.10-cli-observability-recovery.md`

## Goal

`list task --json` emits a single JSON array (`[ {...}, {...} ]`, one
`JSON.parse`). `list event --json` emits JSONL — one object per line
(`stdout.push(JSON.stringify(event))`, `src/apps/cli/events.ts:90`) plus a
trailing `{nextCursor: <cursor>}` sentinel (:119). Same flag name, two
contracts — `JSON.parse` on the whole event output throws.

Binding rule for this story: **each `list … --json` invocation emits exactly
one parseable JSON document.** Change `list event --json` to a single envelope
`{ "events": [...], "nextCursor": "..." }`. Envelope (not a bare array) because
an empty page has no last-event id to derive the cursor from. Migrate every
current consumer, test, and doc in this same story. The non-`--json` human
format is unchanged.

## Contract (tests assert this)

`runEvents` (`src/apps/cli/events.ts:27-140`):

- `--json`: collect the visible events into an array and emit **one**
  `JSON.stringify({ events, nextCursor })` document.
  - `nextCursor` is a string: the cursor to pass to `--after` for the next
    page when `hasMore`, or `""` (empty string, not omitted) when there is no
    next page. Keep it a `string` so consumers never branch on `undefined`.
  - Preserve the probe-row paging (`pageSize + 1`, :54-61) and the
    `hasMore`/`visible` computation (:85-86) — only the **emission shape**
    changes, not what counts as a page.
  - Remove the per-line `JSON.stringify(event)` push (:90) and the trailing
    `{nextCursor}` sentinel push (:119) from the `--json` path.
- `--follow` + `--json`: keep behaving as it does per page, but each page must
  itself be one parseable envelope (do not interleave bare event lines with an
  envelope). If `--follow` streaming genuinely needs line-delimited output,
  keep that under the human/non-`--json` path only; `--json` is one document
  per page.
- Update the doc comment (`src/apps/cli/events.ts:9-25`) to describe the
  envelope contract instead of the JSONL + sentinel contract.
- Human (non-`--json`) output unchanged, including its trailing cursor line
  (:121).

Migrate **every** consumer in the same story:

- `src/apps/cli/events.test.ts` — rewrite the JSONL + sentinel assertions
  (nextCursor at lines ~82, 106-108, 167-170, 197, 227, 251) to parse one
  envelope and assert `{events:[...], nextCursor}` shape, including the empty
  page → `nextCursor === ""` case.
- `docs/flowchart/005.md` (lines ~26, 29, 42, 105, 113) — update the described
  `list event --json` shape to the envelope.
- `.agent/plan/stories/007.7-dependency-event-observability/02-list-event-truncation.md`
  — the truncation-signal spec references the sentinel; note the envelope
  supersedes it (documentation edit, not code).
- Verify shell consumers that `grep` `list event … --json` are unaffected —
  `.agent/plan/epics/007.5-conflict-recovery.md`, `007.9-e2e-resilience.md`,
  `007.3-completion-accounting.md` pipe to `grep`, not `JSON.parse`; the
  envelope still contains the event text those greps match. `e2e-status.sh`
  reads the DB directly and is unaffected (confirm by grep — no
  `list event --json` there).

## Constraints

- Surgical: change only the `--json` emission shape + its direct consumers.
  Do not change the query, the cursor derivation, `--after`/`--limit`/`--follow`
  semantics, or the human format.
- One document per invocation is the rule — no JSONL under `--json`.

## Verification Gate

- `node --test src/apps/cli/events.test.ts` — a non-empty page parses as one
  `{events:[…], nextCursor:"…"}` document with `events.length > 0` and a string
  `nextCursor`; an empty page parses as `{events:[], nextCursor:""}`; a
  truncated page carries a non-empty `nextCursor` that fetches the next page.
- `npm run verify` exits 0.
- Delivers the epic's **Proof C** (`list event --json` parses as one
  `{events:[...], nextCursor}` document with `events.length>0` and a string
  `nextCursor`).
