# AGENTS.md

Rules for every agent that works in the kanthord repository. Ulrich is the human owner.

## Work with Ulrich

- Raise ONE open item per turn, in prose, with the recommendation first. Apply the answer, report, then raise the next item.
- Never put more than one question into one `AskUserQuestion` call. An answer can close an item as a no-op.
- Discuss each open item or blocker with the `/explain` skill, in this order:
  1. The conclusion in one or two sentences.
  2. A numbered timeline of 4 to 8 steps that shows the failure without the fix. Use the names of the vocabulary siblings.
  3. The same timeline with the fix, marked "diverges at step N".
  4. The page changes, line by line.
  5. The recommendation first, then the alternatives with one-line trade-offs.
  6. Exactly one question.
- When Ulrich restates the problem, confirm or correct the restatement at once in three or four bullets.
- When a page already holds the rule, say so first. Then present the ruling as a repair with a confirmation question.
- Prefer to forbid a configuration change over a mechanism that handles the edge case of that change.
- When Ulrich approves a plan of several steps, run all steps in sequence. Do not ask for confirmation between steps. Verify and commit each step. Stop only for a real blocker or for an open item that needs a ruling.
- Open a report with two to four short prose paragraphs that state the conclusion. Put tables, metrics, per-item findings and blocker lists below, under `## Details`.

## Design set

- The design set lives in `docs/brainstorm/`. Each service or shared component has a page `<name>.md`, a vocabulary sibling `<name>.vocabulary.md` and an implementation sibling `<name>.impl.md`.
- Open work lives in `docs/brainstorm/HANDOFF.md`.
- Phase 1 (design pages) is closed. Phase 2 writes the implementation siblings. Phase 3 (epics from the design) starts only when Ulrich closes Phase 2.
- Read the owning page before you take an item.

### Where a ruling goes

- Put a ruled mechanism into the root `.impl.md` of the owning page. Put a daemon-wide mechanism into `architecture.impl.md`.
- A submodule owns the documents that detail its own code. `engine/docs/cli/` holds the command table of each service group.
- A submodule document never overrides a page or a sibling. A conflict is a defect of the submodule document.
- An index row holds a path plus the sibling that owns the declaration. Never strip a declaration from its owner to centralize it.
- Custody, the Repository component and the Storage component are shared components with their own pages. No service owns them.
- Delete the HANDOFF item that carried the reasoning once its answer lands in a page. The page is the rule, and git history is the record.

### HANDOFF queue

- Take items in section order.
- Skip every item with an explicit `POSTPONED` marker. Never infer a postponement from wording such as "after the system runs live".
- Put a postponed item under the section of its owning component with `POSTPONED <date> by Ulrich until <condition>`. Never put it under a Next session list.
- Put a root tooling item under `### Root repository`.
- Remove an item from HANDOFF as soon as its write is verified. Do not keep it until the commit.
- B9 (failure and recovery) comes last. Never open a B9 item on your own initiative. Only Ulrich starts it.

### Protocol for one design item

1. Run `/explain` on the item.
2. Take the ruling from Ulrich.
3. Write the ruling into `docs/brainstorm/HANDOFF.md` under the owning component.
4. Apply the edits yourself with the exact old text and the exact new text.
5. Verify the diff yourself.

- Batch the mechanical items that need no ruling into one edit pass.
- After each ruling, grep the pages that you already wrote for sentences that touch the same actors. A rule phrased as "who performs an action" changes its meaning when a later ruling changes the actor. Re-check every earlier fix against the new ruling.

### Ruled decisions

The pages record only the decision. Read the owning page section before you propose a mechanism. Do not propose an alternative to a ruled decision.

## Contracts

- External contracts (YAML files, CLI input and output, HTTP payloads) use the exact field names of the domain entities in code.
- Never use a shortened alias, for example `deps` for `dependencies`. Never rename a field in an adapter.
- Diff every key of a new contract against the vocabulary sibling of the owning page.
- A divergence from the model is an explicit locked decision, never a naming convenience.
- A human override action takes the CLI flag `--force` and the body field `force: true`. No other flag or field name accepts a risk or bypasses a check.
- Every error code that the engine answers stands on the owning design page and on the `engine/docs/cli/` page of its command group.
- Every command page of `engine/docs/cli/` holds an error-code table with the HTTP status, the code and the condition of each code that its commands answer.

## Database design

- Never declare a SQL `CHECK` constraint, for example `CHECK (kind IN ('repository','worker','storage'))`.
- Define every closed value set as an enum in code. The owning service validates the value before the write.
- Never declare an index that is not a unique index.
- The schema lives in `docs/reference/erd/` and records only ruled design. Keep HANDOFF items out of it.
- `project_id` is the second key column only in project-scoped tables.
- Write every table name, every column name and every property name inside a JSON column in snake_case. The name of an external library or protocol is no exception. Only a ruling of Ulrich that names the external requirement permits another case.
- An Intake inbound event stays until a human deletes it. No automatic retention exists.
- A rename of a table or a column also updates the map in `docs/reference/erd/README.md`.
- `docs/viewer.html` pins mermaid 11.17.2. Never pin a version below 11, because the ERD views use `classDef` in an `erDiagram`.

## Dashboard design

- A list row of a revisioned record shows its effective revision as `(v<revision>)` next to its name or identity.
- Show one revision per row. Never show a second revision field beside it.

## Shared working tree and commits

Several agents edit the same working tree in parallel, for example `docs/brainstorm/HANDOFF.md` and `engine/docs/cli/*`.

- Edit HANDOFF by quoted sentence only. Never revert a foreign change.
- Commit design pages per step. Leave HANDOFF uncommitted until a batch ends or Ulrich asks.
- Stage exact paths only. Never use `git add -A`. Never stage a file with the uncommitted edits of another agent.
- Commit directly on `main`. Do not create a branch, because a branch switch moves HEAD under the other agents.
- Write every commit subject in the format `<type>(<scope>): <subject>`. The `(<scope>)` part is optional.
- Write the subject in the present tense, for example `feat: add hat wobble`.
- Use only one of these types:
  - `feat`: a new feature for the user. A new feature for a build script is not `feat`.
  - `fix`: a bug fix for the user. A fix to a build script is not `fix`.
  - `docs`: a change to the documentation.
  - `style`: formatting, for example a missing semicolon. No production code change.
  - `refactor`: a change to production code that keeps the behavior, for example a variable rename.
  - `test`: a new test or a refactor of a test. No production code change.
  - `chore`: a change to build tasks or tooling. No production code change.

## Repository tooling

- `kanthord` is a superrepo with the submodules `engine` (Node 24 daemon) and `apps` (pnpm + turbo, Vite React dashboard).
- Every `make` target wraps `scripts/<category>/<command>.sh`.
- Run `make repo-bootstrap` first in a clone. It is idempotent.
- `make up` and `make down` start and stop both sides. Pids and logs go to `.dev/`.
- `make sync-all` publishes the submodules. The `tree-*` targets manage worktrees of the submodules only.
- The daemon listens on port 31415. The web app listens on port 27182 at `http://localhost:27182`.
- Check the web app in a browser with the `ego-browser` skill. The `chrome-devtools` MCP server cannot connect, because another Chrome holds port 9222.
- Emulate a phone width with `page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })`. Ask Ulrich for a human token when the saved instance refuses its token.
- Both submodules pin `pnpm@11.24.0`. Keep `minimumReleaseAge` in `.npmrc`.
- pnpm forwards `--` literally. Write `pnpm run X --flag`, not `pnpm run X -- --flag`.
- The `.githooks/pre-commit` hook refuses a root commit whose staged gitlink is not on the `origin/main` of that submodule. Move a root pointer only after the submodule commit is pushed.
