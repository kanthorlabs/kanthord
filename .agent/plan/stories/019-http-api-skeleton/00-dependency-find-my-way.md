# Story 00 — dependency `find-my-way` (maintainer; ALREADY DONE)

Epic: `.agent/plan/epics/019-http-api-skeleton.md`

**Do not dispatch this story to `/work`.** `package.json` and `package-lock.json`
are lane-forbidden to every role (`scripts/lane-check.sh:17`).

## Change

None. The dependency is already installed:

- `package.json:40` — `"find-my-way": "^9.7.0",`
- `package-lock.json:15,3751-3753` — resolved `find-my-way-9.7.0.tgz`
- `node_modules/find-my-way/` present, version `9.7.0`

## Constraints

- No other dependency is added by this epic. `jwt.ts` uses `node:crypto` only —
  do not add `jose`.

## Verify

- `node -e 'console.log(require("./node_modules/find-my-way/package.json").version)'`
  prints `9.7.0`.
- `git diff --stat package.json package-lock.json` is empty while the epic runs —
  no story may touch either file.
- Proof: none (this story delivers no Proof phase).
