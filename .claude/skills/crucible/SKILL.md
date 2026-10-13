---
name: crucible
description: Rewrite, review or reader-test a KanthorD documentation page or page set. Authors from the code, verifies with an Opus sub-agent, then tests with a Haiku reader that emulates a mid-level engineer. Use it when Ulrich asks to redesign, verify or reader-test documentation, or invokes /crucible.
---

# /crucible

Usage: `/crucible [$ARGUMENTS]`

`$ARGUMENTS` names the topic and the pages, for example `worker: explanation/worker.md, coder-worker.md`. With no arguments, ask for the topic and the page list.

The skill turns a documentation page set into pages that a mid-level engineer understands from the concept down to the low level.

Set `S=.claude/skills/crucible/scripts` and `T=.claude/skills/crucible/templates` in the root of the worktree. Run every script from the worktree root.

## Purpose and the three fires

1. **Code-grounded authoring.** Write every claim from the code. The design pages state the intended behavior. The code states the built behavior.
2. **Opus verification.** An Opus sub-agent at high effort checks every claim against the code and reports findings.
3. **Haiku reader test.** A Haiku sub-agent at medium effort emulates a mid-level engineer. It answers questions from the pages only. A wrong answer is a defect of the docs, not of the reader. Fix the docs, never the question.

Do all three fires in order. Never skip fire 3 because fire 2 found nothing.

## Phase 0: Preflight

1. Run `sh $S/preflight.sh <name>`.
2. If the script reports dirty work, stop. Advise Ulrich to commit, stash or discard each change. Give the recommendation first. Wait for the ruling.
3. Otherwise the script creates the worktree `.dev/<name>` on branch `docs/<name>` from `main` and runs `make bootstrap`. Work only in that worktree.
4. Use `--dry-run` to check the state with no change.

## Phase 1: Research

Read in this order. Stop at the first source that states the fact.

1. **The code** in `engine/src`. It is the truth for built behavior.
2. **The design pages** in `docs/brainstorm/`: `<service>.md`, `.impl.md`, `.vocabulary.md`. They are the truth for intended behavior.
3. **The reference pages** in `docs/reference/`.

Also read the target pages and their sibling pages in `docs/explanation/`.

Verify in the code every number, default, path, state name, payload and order of steps. Name the actor of each action.

Append each finding to the repo-root `.dev/notes.md` at the moment it happens.

Look for these three findings while you read:

- An undocumented branch, for example an end of the budget at one boundary that releases with `further_work: false`.
- A missing concept, for example a fallback chain with a cooldown.
- A gap between design and code.

When the reader needs behavior that the code does not build:

1. Write the designed rule in the page.
2. Add one sentence that starts with `Today` and states the gap. Example: `Today the hold covers the executions of one worker process only.`
3. Add one HANDOFF item to `docs/brainstorm/HANDOFF.md` under the owning component. Fill `$T/handoff-item.md`. Name the code file and symbol, the design anchor and the explanation anchor.
4. Search HANDOFF for an item of the same gap before you add one.

## Phase 2: Author

### An entry page

An entry page introduces the concept above its detail pages. Write the sections in this order.

- [ ] What it is, in one paragraph. Name the two or three detail pages.
- [ ] The idea in five sentences.
- [ ] A glossary table. One meaning per term.
- [ ] Who does what. A table of actor, owns, does not own.
- [ ] The lifecycle as a state flowchart.
- [ ] One end-to-end walk: a sequence diagram and numbered steps in plain words.
- [ ] A variants table.
- [ ] The second actor, for example the reviewer.
- [ ] Limits.
- [ ] Invariants: rules that hold in every execution. Each rule explains one surprise.
- [ ] Where the state lives. A table of durable state and cache.
- [ ] Where it runs and the setup steps.
- [ ] Read next.

### A detail page

- [ ] Link the entry page ("read first") at the top.
- [ ] `In short`: summary bullets.
- [ ] A division-of-labour table.
- [ ] An at-a-glance diagram and a phase table. Column: the question that each phase answers.
- [ ] A worked example first. Use the happy path with real payloads.
- [ ] Each phase in detail.
- [ ] Decision tables. State that the first matching row decides.
- [ ] A `how it ends` table: end, action, release body, next state.
- [ ] An edge-case table.
- [ ] One example per edge case. Each example starts from the run above and changes one fact.
- [ ] Internals (`under the hood`) last.
- [ ] Telemetry.
- [ ] Limits.

### Writing rules

- Lead with the result. Show the composed prompt before the layers that build it.
- Explain why for each rule.
- Define each term at its first use. Use one word for one meaning.
- Follow the technical-text rules of `~/.claude/CLAUDE.md`: ASD-STE100, at most 20 words per instruction sentence and 25 per description, simple tenses, active voice, no filler.
- Keep code and identifiers exact.
- Write no code comment.

### Diagram rules

- Copy the `%%{init: ...}%%` theme block from an existing diagram in `docs/explanation/*.md`. Use the flowchart block for flowcharts and the sequence block for sequence diagrams.
- Give every diagram `accTitle` and `accDescr`. The description states the full path in words.
- Put no fact only in a diagram. Repeat it in text.

### Index and navigation

Update all three. A page without them is hard to find.

1. `docs/explanation/README.md`: one bullet per page.
2. `docs/README.md`: one row in the question table.
3. `docs/index.html`: one `<li>` in the navigation.

## Phase 3: Gate and commit

1. Run `sh $S/gate.sh`. It runs prettier on the changed docs files, then `scripts/docs/check.sh`.
2. Read the one-line result. `FAIL at <step>` names the failing step. Fix it and run again.
3. Commit one step at a time. Stage exact paths. Never use `git add -A`.
4. Write the subject as `docs(<scope>): <subject>` in the present tense.
5. Never commit to `main`. Never switch the branch of the root checkout.

## Phase 4: Opus verification

Run it after the first complete draft and after each large rewrite.

1. Write two optional files in the scratchpad:
   - `focus.md`: the risky claims, one bullet each (numbers, defaults, branches, actors).
   - `checks.md`: the questions that the reader must be able to answer.
2. Build the prompt: `python3 $S/make-prompt.py verify --topic "<topic>" --pages p1=role,p2=role --base main --code engine/src/<area> --design docs/brainstorm --focus focus.md --checks checks.md`.
3. Pass the printed text unchanged to the Agent tool: `subagent_type` general-purpose, `model` opus, `effort` high, run in the background.
4. Wait for the notification. Do not poll.

### Triage

1. Re-check each B item in the code yourself. Never trust the reviewer without evidence. Read the cited line.
2. Apply all findings by default, cosmetic ones included. Mark an item `action:NO` only with a stated reason.
3. A finding that exposes a gap between design and code needs a `Today` sentence and a HANDOFF item. See Phase 1.
4. Append each fix to `.dev/notes.md`.
5. Run the gate. Commit the fixes.
6. Report the findings in the bullet format of Ulrich:

`<B1/S1> - status:<FIXED/OPEN> - action:<YES/NO> - <name> - <description> - fix:<recommended change> - why:<reason>`

`B` is a factual error, a regression or a broken link. `S` is clarity, completeness or consistency. Every item carries a `status`, a `fix` and a `why`. Never put findings in a table.

## Phase 5: Haiku reader test

### Write the questions and the key

1. Copy `$T/questions.md` to the scratchpad. Write 15 to 25 questions.
2. Write the answer key in `$T/answer-key.md` shape. Verify every key entry in the code. Cite the code file for each fact.
3. Store the key in a different file and a different directory than the questions. Never name the key path in any prompt. Never give the key to the reader.

Question design rules:

- Ask for a scenario, not for a quote. A reader that finds the sentence by search must still need to understand it.
- Make each question answerable from the pages.
- Ask for exact values: a payload, a state name, a count, a default.
- Cover each category at least once:
  - definitions and the difference between near terms;
  - the trace of a lifecycle;
  - "X happens. What does the system do, which exact payload, which next state?";
  - limits and counts;
  - where state lives;
  - setup steps and what each host needs;
  - recovery and human override;
  - why-questions.
- Cover each edge case that the pages describe.
- Keep a question standalone. It must make sense with no other question.

### Run the reader

1. Build the prompt: `python3 $S/make-prompt.py read --topic "<topic>" --pages entry.md,detail1.md,... --questions questions.md`. List the entry page first.
2. Pass the printed text unchanged to the Agent tool: `subagent_type` general-purpose, `model` haiku, `effort` medium, run in the background.
3. Use a fresh agent for each round. Never continue an earlier reader with SendMessage.
4. Save the full agent output to a file, for example `answers-r1.md`.

### Grade

1. Run `python3 $S/grade.py --answers answers-r1.md --key key.md --out grade-r1.md`. Add `--questions questions-r2.md` in a later round.
2. Open the sheet. Read the `Must review` list first.
3. For each row, compare the answer with the key. Fill `verdict` with `correct`, `partial` or `wrong`. The script never judges.
4. For each `partial`, `wrong`, low-confidence, `NOT IN DOCS` or contradiction row, fill `doc cause` with one cause:
   - **fact missing**: no page states it.
   - **fact scattered**: the answer needs several sections that never meet.
   - **vague quantifier**: a phrase such as `at the limit` hides the number or the side.
   - **undefined or overloaded term**: for example `revision` or `stop` with two meanings.
   - **contradictory wording**: two passages disagree, for example on precedence.
   - **fact only in a diagram**: the text does not repeat it.
   - **actor inferred**: the reader must guess who acts.
5. Fix the pages, never the question. Name the cause in the commit body or in `.dev/notes.md`.
6. Run the gate and commit.

### Round 2 and later rounds

1. Run `python3 $S/subset.py questions.md 5,8,20 > questions-r2.md`. List the failed and flagged numbers.
2. Edit `questions-r2.md` so that each question stands alone. Add the context from the removed questions.
3. Build a new read prompt with `--questions questions-r2.md`. Start a fresh Haiku agent.
4. Grade again. Repeat until every verdict is `correct`.
5. Fix the residual friction that the `General reading feedback` names.

Example result of the first session: round 1 15 of 21 correct, round 2 7 of 7.

## Phase 6: Outside-docs drift sweep

A rewrite proves facts. Other pages can still state the old facts.

1. Run `sh $S/drift.sh`.
2. Part (a) lists a pinned version that a page states differently. Part (b) lists a link or an anchor that does not resolve. Fix every hit.
3. Part (c) lists lines with `Current limitation`, `not yet` or `Today `. Review each line by hand against the code.
4. Also search by hand for renamed enums, new enum members, removed items, missing items and tables that miss an operation.
5. Fix root pages in the root branch.
6. A submodule document (`engine/docs/cli/`) needs its own branch and its own pull request in the submodule repository. Run the submodule gate there. Move a root pointer only after the submodule commit is pushed.
7. Run `sh $S/gate.sh` and commit each step.

## Report to Ulrich

1. Open with two to four short prose paragraphs. State the conclusion: what changed, what the three fires found, what stays open.
2. Add `## Details`. Put the metrics, the reader-test rounds and the finding bullets there.
3. Write every finding in the bullet format of Phase 4.
4. List the commits, the new HANDOFF items and the files outside the pages that changed.
5. Offer the push and the pull request. Do not push without Ulrich.
