# Handoff

This file is a working note. It is not a design document. Phase 2 produces no `.current` or `.drift` sibling for it.

Written 2026-09-08. Repository head at the time of writing: `a25ed7b`.

## State

`docs/overview.md` is rebuilt and committed at `a25ed7b`. It waits for Ulrich's approval.

No other document in `docs/` is rewritten. Nine stub pages and `legend.md` still carry the rejected method.

## The method

`CLAUDE.local.md` holds the documents rule and the orchestration protocol, under `## Documents`. That file is gitignored, and a new session loads it as context. Read it there. This file does not repeat it.

The rule replaced an earlier approach that failed. The earlier overview defined kanthord by what was reachable at one engine commit: a status line on every claim, commit-pinned citations to private source files, and a claims register of `C01` through `C16`. The product model was inferred from the code, so the external harness read as the product.

## Rulings from Ulrich

Do not re-derive these and do not re-open them.

- The strategy is WHAT, HOW, WHO, mapped to two harness systems.
- The WHAT is initiative, objective and task. It carries the goal, the steps and the validation criteria. Both harnesses share it.
- The HOW of kanthord's own harness is the worker. A worker is an instance. It implements the steps, and it includes the methods, the agents, the tools and the memory.
- The WHO is the responsible entity. It is a specific agent, or a human participant.
- The external harness supplies its HOW through its own orchestration skill, usually named `/work`, and it reaches the work model through the CLI or the API.
- kanthord's own harness mostly uses deterministic methods and predefined processes. An external harness may use dynamic and adaptive approaches.
- Every level of initiative, objective and task must have an outcome. Only a human can override an outcome to make a bypass exception. An override produces a new outcome that reflects the human assertion, and the previous outcome is kept as a reference.
- `worker` is the correct word for the HOW.
- Memory is named in the product model.
- `general@1` is the correct name. `generate@1` is not a name in use.
- The external harnesses are `claude-code` and `opencode`.
- An external harness never takes priority over kanthord's own harness.
- The external harness is not legacy. It is an ongoing maintenance and integration workflow that Ulrich keeps with an existing system.
- `tdd@1` is one worker implementation. More will ship. No document describes only `tdd@1`.
- A project holds the repository strategy. One project requires a pull request for every change. Another project uses a branch, then a merge, then a push to main. The strategy is project configuration, and it is not the worker's job.

## Conclusions taken by reasoning

Ulrich did not state these. Each is a reasoned proposal in `docs/overview.md`, and each reverses on one word from him.

- A human assertion of success ends a running worker.
- A worker requires a configured repository strategy before it acts on a repository, so no implicit default exists.
- A worker performs the configured repository action before it produces the objective's outcome.
- The repository strategy rule is conditional. It governs a worker that acts on a repository, because nothing establishes that every worker acts on one.

## Deliberately unstated

Nothing establishes these. Ask Ulrich before any document asserts one.

- How a `project` relates to initiative, objective and task.
- Who merges an open pull request.
- How an external harness applies the repository strategy.
- What a worker does at initiative level.

## Next steps

1. Ulrich approves or corrects `docs/overview.md`.
2. Rewrite `docs/legend.md` under phase 1. Its sections 2, 6 and 7 mandate per-claim status, a commit-pinned source citation on every page, and live-legacy notices. All three force existing code into a design document, which phase 1 forbids.
3. Rewrite or delete the nine stub pages: `capability-status.md`, `identity-access.md`, `recovery.md`, `reference.md`, `setup-registration.md`, `state-completion.md`, `system-map.md`, `who-does-work.md`, `work-graph.md`. Each holds a title, a question and the line "Not written yet". Their questions were chosen against the rejected model, so a rewrite re-derives the destinations rather than inheriting them.
4. Start phase 2 only after the design set is approved. Each design file gets `<name>.current.md` and `<name>.drift.md`.
5. Phase 3 turns drift entries into epics, the way epics 050 to 057 were created.

`docs/overview.md` carries no document map. The nine destinations were designed against the wrong model, and a map returns when the detail documents exist.

## Working notes

**The debate engine.** `KANTHOR_DEBATE_ENGINE=pi`. The skill lives at `~/.claude/skills/debate`. Call `scripts/run.sh --check`, write the debate block to the `args` path it prints, then call `scripts/run.sh <args-path>`. Run it in the background; a pass takes two to four minutes.

**The writer.** `/pi` routed this work `hard` at score 6, to `gpt-6-astra` at high effort.

**Do not trust the writer's self-check.** Pi ran nine times on `docs/overview.md`. It reported its own seven-point acceptance as pass on every run, and it reported zero defects. All eleven defects came from the adversarial review pass or from reading Pi's output directly. One of those runs left the same rule stated twice with different members and still self-reported a pass.

**The pre-commit hook.** `.githooks/pre-commit` validates the `engine` and `apps` gitlinks. The `apps` pointer is staged and is not on its `origin/main`, which predates this work. A docs-only commit therefore needs `git commit --only <path>` together with `KANTHORD_SKIP_SUBMODULE_PUSH=1`. Verify afterwards that `HEAD:apps` and `HEAD:engine` are unchanged. The sanctioned alternative is `make sync-all`, which pushes the submodules, and only Ulrich decides to publish.

**Uncommitted and not part of this work.** `README.md`, the `apps` and `engine` pointers, and the untracked `docs/serve.json`. Leave them alone.

## The eleven defects, so no rewrite repeats them

1. `harness` defined as a third-party program, which left kanthord's own harness unnamed.
2. An identity section that described the document's organization instead of the product.
3. A level hierarchy invented as broad, focused and specific, with no reason stated.
4. `worker` given two incompatible senses in one entry, an implementation and an execution.
5. A worker loop with three exceptional endings and no success ending.
6. A promise that initiative behaviour differs, followed by no description of it.
7. A universal outcome rule that produced an outcome only on success.
8. Loop termination reading evaluation alone while an outcome allowed two sources.
9. A non-success outcome asserting that validation failed when validation never ran.
10. The same three-way rule stated twice, with different third members.
11. Successful termination able to skip the configured repository action.
