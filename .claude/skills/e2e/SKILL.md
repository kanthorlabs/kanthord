---
name: e2e
description: Run an end-to-end acceptance test of a kanthord feature in a real browser with ego-browser, and write the proof - a screenshot per UI step plus an acceptance-criteria checklist - into .dev/e2e/<YYMMdd>-<feature-name>/. Use when the user asks to e2e test, acceptance test, verify a feature in the app, or prove a journey works end to end.
---

# e2e

Drive the kanthord web app in a real browser. Prove a feature against its written acceptance
criteria. Leave a proof directory a human can audit without repeating the run.

Use the `ego-browser` skill for every browser action. Read it first.

The phases run in order. The acceptance criteria decide how the environment is built, so the
criteria are resolved before any process starts.

## Phase 1 - Resolve the acceptance criteria

Do this before you start or check any process.

1. Search all three plan roots:
   - `./.agents/plan/**`
   - `apps/.agents/plan/**`
   - `engine/.agents/plan/**`

   Each initiative directory holds `initiative.md`. Each objective directory holds `objective.md`
   and the task files `NN-<slug>--<id>.md`. The criteria live under a `## Acceptance criteria`
   heading in `objective.md` and in each task file.
2. List every candidate objective by path and title. Report the list.
3. Stop and ask with AskUserQuestion when zero objectives match, or when more than one matches.
   Never select an objective silently.
4. Collect the objective criteria and the criteria of each task in scope. Name the task files in
   scope in the report.
5. Report a contradiction between an objective criterion and a task criterion. Do not merge them.
6. `apps/docs/api/contract` and `docs/` give context. They are not acceptance criteria.
7. Ask the user for the criteria when no plan matches. Do not invent a criterion. Do not continue
   without criteria.
8. Quote each criterion verbatim. Split a composite criterion into atomic checks. Keep the verbatim
   original next to the atomic checks.
9. Name the observable that proves each criterion, and the step that produces it, before you act.
   A criterion with no observable is a blocker. Report it and ask.

## Phase 2 - Derive the environment contract

Read the criteria for isolation, data and secrecy demands. Then pick the target.

**Shared dev stack (the default).** Run `make up` from the repository root. The engine listens on
31415. The app listens on 27182. The first Flutter web build takes about one minute. This stack
uses the developer's own daemon home. Name every record the run will write or delete. Get explicit
confirmation before the first write.

**Isolated stack.** Use it when a criterion names a disposable home, a cleanup duty, or an
irreversible write. Create the home with `mktemp -d`. Generate its config with
`node engine/src/main.ts config generate --home <home>`. Start the daemon against that home.
`trap` the removal of the home.

Record these facts. Do not assume them:

- `git -C engine rev-parse --short HEAD` and `git -C engine status --porcelain`, and the same for
  `apps`. A dirty tree is part of the record.
- Whether this run started the stack, or reused a running one. A reused process can predate the
  recorded commit. The report states this. It never implies provenance it did not verify.
- The byte size of `.dev/engine.log` before step 1. The log scan later reads from that offset, so
  it sees only this run.

## Phase 3 - Preflight as a capability smoke test

Prove each capability. Do not assume it. Stop on the first failure and report it.

| Check | Proof |
|---|---|
| ego lite runtime | one heredoc returns `await getBrowserVersion()` |
| visible window | `(await pageInfo()).w > 0` |
| task space | `useOrCreateTaskSpace` returns an id |
| tab and navigation | `openOrReuseTab(appUrl, { wait: true })`, then `pageInfo().url` matches |
| screenshot to disk | write into the run directory, then assert the file exists and its size is > 0 |
| semantics | `snapshotText()` returns usable roles for the app |
| engine | `make status` polled to a timeout: `engine: running` and `/v1/health -> 200` |
| app | `make status` reports `app: running`, and the app URL answers |

`w: 0` means the ego lite window is not on screen. `captureScreenshot` times out in that state.
Run `open -a "ego lite"`, wait, then check again.

ego-browser is macOS only. It has no headless mode. It needs a visible window and a graphical
session. The report states that this run is a local interactive acceptance test, and not a CI gate.

Tell the user when `ego-browser` is missing. Follow `~/.claude/skills/ego-browser/references/install.md`
only after the user agrees. The install changes the machine and needs graphical onboarding.

The journey must need no login, no captcha and no manual step. Call `handOffTaskSpace` when one
appears, and tell the user what to do. A handoff makes the run attended. Name the handoff in the
report. Never claim an unattended PASS after a handoff.

## Phase 4 - Run the journey

Create the run directory and `run.json` before the first action. Append each step record as it
happens, so a crash still leaves evidence.

The Node runtime exits after every heredoc and keeps no state. Start every round by reacquiring the
task space with the literal id read from `run.json`. Reacquire the tab with `openOrReuseTab`. The
final heredoc creates its own handle before it completes the space.

Use one task space named `e2e-<feature-slug>`.

Run each step in this order:

1. Act.
2. Wait for the expected state with `waitForElement` or `waitForNetworkIdle`, with a bounded timeout.
3. Take a fresh `snapshotText()`. `@N` refs expire on the next snapshot.
4. Assert the named observable.
5. Capture the screenshot to an absolute path under `steps/`.
6. Assert the PNG exists and its size is > 0.
7. Append the step record.

Capture the failure state first when a wait times out. Then abort.

Rules:

- Generate two distinct per-run values. A **record tag** `e2e-<YYMMdd>-<rand>` names every record
  the run creates, and the run asserts it by exact name. A **credential sentinel** is a separate
  value that the run never prints.
- Assert an exact name. Never assert a count.
- Prefer the `loc=role:...` targets from `snapshotText()` over raw CSS.
- The app is Flutter web. Use the visual workflow when `snapshotText()` gives nothing usable:
  record the viewport size, capture the screenshot immediately before the click, do not resize the
  window between the capture and the click, then assert the exact postcondition. A click that looks
  correct is not evidence.
- `drainEvents()` carries headers and bodies. Keep the method, the path and the status. Discard the
  rest.
- Never write a credential, a token, a request body or the sentinel into a log, a snapshot or the
  report.

## Phase 5 - Evidence classes

A screenshot proves a visible state. It proves nothing else. Cite the class that proves each
criterion:

- **UI screenshot** - a visible state.
- **Attribute assertion** - `disabled`, `readonly`, `checked`, an `aria-*` value. A grey button is
  not proof of its state.
- **Navigation** - the value of `pageInfo().url`.
- **Network metadata** - method, path and status only.
- **Process evidence** - the daemon home path, the pid, the port.
- **Log scan** - `.dev/engine.log` read from the offset recorded in Phase 2.
- **Sentinel sweep** - the sentinel appears in no snapshot, no visible text, no input value, no
  report file and no captured log.

Never capture a credential field unless the field is masked and the snapshot does not carry its
value.

## Phase 6 - Write the proof

Write everything to `.dev/e2e/<YYMMdd>-<feature-slug>/`. Slug the feature name. Add the suffix `-2`,
`-3` when the directory exists. Never overwrite a previous run. `.dev` is gitignored, so the proof
stays local.

```
.dev/e2e/260829-provider-registration/
  report.md
  run.json
  console.log
  steps/01-open-dashboard.png
  steps/02-open-register-form.png
```

`report.md` carries, in this order:

1. **Run record.** Date, feature, the user inquiry verbatim, the criteria source paths, the ego lite
   version, the engine and apps commits with dirty state, started or reused, the daemon home, the
   ports, the task space name, and the statement that this is a local interactive test.
2. **The checklist.** One line for each criterion:

   `- [x] <criterion verbatim> - evidence: <class> - proof: steps/04-submit.png - observed: the list row reads e2e-260829-a4f1`

   Use `- [ ]` for a failed criterion, and state what was observed instead. Use `- [-]` for a
   criterion that does not apply, and state why. A criterion is `[x]` only with a named observable
   and its artifact.
3. **The steps table.** Number, action, target, screenshot file, result.
4. **Defects.** Anything observed that no criterion covers.
5. **Verdict.** PASS only when every criterion is `[x]`. One `[ ]` makes the run FAIL.

Report a FAIL in the chat. Never leave a FAIL only in the file.

Delete the records the run created, and the disposable home when the run used one.

Close the task space in its own final heredoc, after `report.md` is written. Use
`completeTaskSpace(id, { keep: false })` on a PASS. Use `{ keep: true }` on a FAIL, and tell the
user the page stays open for diagnosis.

## Verified caveats (ego lite 0.4.7.3)

- `await captureScreenshot('/abs/path.png')` writes the PNG and returns the path. It writes a temp
  file when it gets no argument.
- A screenshot fails with `Cannot take screenshot with 0 width` when the ego lite window is not on
  screen. Check `pageInfo().w` first.
- `require(...)` and a top-level `await` cannot appear in the same heredoc. Use
  `await import('node:fs')`.
- Create `steps/` before the first capture.
