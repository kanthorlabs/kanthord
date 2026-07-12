# Story 001 - real GitHub HTTP seam

Epic: `.agent/plan/epics/019.7-broker-live-delivery.md`

## Goal

Provide a real `GithubHttpSeam` implementation (the interface
`github-create-pr.ts` already declares) backed by `fetch` against
`api.github.com`, so `makeCreatePrAdapter` can create/poll/reconcile real PRs.
Today only in-process doubles implement the seam.

## Acceptance Criteria

- A factory returns a `GithubHttpSeam` with `createPr`, `getPr`, and
  `listByHead`, each issuing an authenticated `fetch` to the GitHub REST API with
  the `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`
  headers and mapping the HTTP response to the seam's declared response shapes:
  - `createPr` → `201` maps to the created-PR shape (number + url); `422` with a
    "already exists" body maps to the duplicate shape; `429` maps to the
    rate-limit shape (with `retry_after`).
  - `getPr` → returns the PR state shape (open / closed / merged) from the PR
    resource.
  - `listByHead` → returns the array of `{ number, state, url }` for a head
    branch.
- The base URL is configurable (defaults to `https://api.github.com`) so the
  hermetic test points it at a loopback mock; no method calls a non-loopback host
  under `npm test`.
- The seam never logs or embeds the raw token in a thrown error or return value.

## Constraints

- **REST/fetch for this seam (not `gh` CLI)** — `create_pr`/`getPr`/`listByHead`
  need deterministic, structured, status-coded responses for the broker's
  submit/poll/reconcile contract; the CLI-first rule yields here (git-platform
  memory: "REST only where a structured response is required"). Uses the platform
  `fetch` (Node 24) directly — no HTTP client dependency.
- **Implements the existing `GithubHttpSeam`** from `github-create-pr.ts`
  unchanged — this story adds an implementation, it does not reshape the seam.
- **Hermetic test uses a loopback `node:http` mock** so the zero-network guard
  stays green; the real-API path is covered by the live proof (LP-A1/LP-A4).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the seam test passes against a
  loopback mock and the guard stays green.

### Task T1 - fetch-backed GithubHttpSeam

**Input:** `src/broker/verbs/github-http.ts`, `src/broker/verbs/github-http.test.ts`

**Action - RED:** a hermetic test starts a loopback `node:http` server that
asserts the request path/method/headers (Bearer token, Accept) and returns canned
GitHub responses; it drives `makeGithubHttpSeam({ baseUrl, token })` and asserts:
`createPr` maps `201`→created shape and `422 already exists`→duplicate shape;
`getPr` maps a merged PR body→merged state; `listByHead` returns the parsed
array. It also asserts a thrown error for an unexpected status carries no token.

**Action - GREEN:** implement `makeGithubHttpSeam({ baseUrl?, token })` in
`src/broker/verbs/github-http.ts` using `fetch`, returning a `GithubHttpSeam`;
map statuses to the declared response shapes; keep the token out of errors.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/broker/verbs/github-http.test.ts` green.
