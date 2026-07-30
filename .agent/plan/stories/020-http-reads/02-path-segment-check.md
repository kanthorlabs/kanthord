# Story S2 — the singular-path machine check

Epic: `.agent/plan/epics/020-http-reads.md` (decisions 1 and 2)
Depends on: Story S1 (`Route` is the erased type the test iterates).

## Change

`src/apps/http/routes.test.ts` — add, directly below the existing
`BANNED_VERBS` const (`:8-35`), the segment vocabulary and its predicate. Change
nothing in the existing verb list or the existing tests.

```ts
/**
 * Every legal STATIC path segment. Decision 1 (EPIC 020): resource segments are
 * SINGULAR nouns, so a new resource is a deliberate, reviewed entry here — the
 * same discipline BANNED_VERBS applies to verbs.
 */
const PATH_SEGMENTS = [
  "api",
  "healthz",
  "project",
  "initiative",
  "objective",
  "task",
  "resource",
  "repository",
  "credential",
  "notification",
  "filesystem",
  "ai-provider",
  "model",
  "queue",
  "overview",
  "graph",
  "conflict",
];

/**
 * A plural segment is caught by the trailing `s` rule applied to the CURATED
 * list above, not to arbitrary paths: over arbitrary paths `/s$/` false-positives
 * on real singular nouns (`status`, `progress`), and a test people must disable
 * is worse than no test. A genuine singular ending in `s` is named here.
 */
const NOT_PLURAL: string[] = [];

function staticSegmentsOf(path: string): string[] {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .filter((s) => !s.startsWith(":"));
}
```

Then add three tests after the existing REST-shape tests (`:131-143`):

```ts
test("path vocabulary: every static segment is in the PATH_SEGMENTS allowlist", () => {
  for (const route of ROUTES) {
    for (const segment of staticSegmentsOf(route.path)) {
      assert.ok(
        PATH_SEGMENTS.includes(segment),
        `route ${route.id} path ${route.path} uses unlisted segment "${segment}" — add it to PATH_SEGMENTS (singular, decision 1)`,
      );
    }
  }
});

test("path vocabulary: no allowlisted segment is a plural", () => {
  for (const segment of PATH_SEGMENTS) {
    if (NOT_PLURAL.includes(segment)) {
      continue;
    }
    assert.equal(
      segment.endsWith("s"),
      false,
      `segment "${segment}" looks plural — resource segments are singular (decision 1); if it is genuinely singular, name it in NOT_PLURAL`,
    );
  }
});

test("path vocabulary negative control: a plural segment is rejected, the singular is accepted", () => {
  assert.equal(
    staticSegmentsOf("/api/projects").every((s) => PATH_SEGMENTS.includes(s)),
    false,
  );
  assert.equal(
    staticSegmentsOf("/api/project/:id").every((s) =>
      PATH_SEGMENTS.includes(s),
    ),
    true,
  );
});
```

## Constraints

- `PATH_SEGMENTS` is written in full now (all 17 entries), so stories S4–S9 add
  rows without editing this file.
- `NOT_PLURAL` ships empty. Do not pre-populate it.
- Do not merge this predicate into `hasBannedVerbSegment` — the two checks stay
  separate tests with separate messages.

## Verify

- `node --test src/apps/http/routes.test.ts` passes (2 existing rows use only
  `api`-free segments `healthz` and `/`, both legal: `/` has no static segment,
  `/healthz` has one and it is listed).
- Temporary manual check the implementer performs and then reverts: renaming
  `project` → `projects` inside `PATH_SEGMENTS` makes the plural test fail;
  adding a row with path `/api/widget` makes the allowlist test fail.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase B, line
  `ERR "plural path" "/api/projects" "404" "unknown_route"` — this story is the
  hermetic half of that statement.
