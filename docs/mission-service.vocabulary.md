---
title: Mission Service Vocabulary
---

# Mission Service Vocabulary

This file holds the values and the examples of the terms that [mission-service.md](viewer.html?p=mission-service.md) owns.
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `mission-service.md` stays the single source of truth.
Section 5 and section 6 of that page are not written.
The entries for `attempt`, `attempt counter` and `evaluation attempt` rest on a settled wording ruling, and section 5 will state their design.

## level

A level is a node of the mission graph. The set is closed and it holds three values.

- **initiative**
- **objective**
- **task**

Nothing else is a level. The word names a node of the graph, and it never names a tier or a degree.

## attempt

One try at a level.
Write `level attempt` where `evaluation attempt` appears nearby, because the two are different objects.
Write `attempt` alone everywhere else.

Take the objective "Add password reset". A `tdd@1` instance and a `reviewer@1` instance work it.

Attempt 1 opens.

1. A `tdd@1` instance claims the objective. Run 1 starts.
2. Run 1 runs a RED-GREEN-REFACTOR loop for each task, on a branch, with one commit for each task.
3. Run 1 opens a pull request, then releases. Run 1 ends. Attempt 1 stays open.
4. A human merges the pull request. An observer records the landing. Attempt 1 stays open, and no run is in flight.
5. A `reviewer@1` instance claims the objective. Run 2 starts.
6. Run 2 publishes an assessment that does not pass. Attempt 1 closes, and the level is blocked.

Attempt 2 opens.

7. A human unblocks the level. Attempt 2 opens, and it holds no claim.
8. A `tdd@1` instance claims the objective. Run 3 starts.

One objective, two attempts, three runs.
Step 3 to step 5 is the span that no other term covers.
A run ends at its release, and the attempt continues while the pull request waits for days.
Every record of step 1 to step 6 names attempt 1 forever, and no record migrates into attempt 2.

## attempt counter

The per-level ordinal that names which attempt a record belongs to.
The counter of the objective above reads 1 during step 1 to step 6, and it reads 2 from step 7.
The counter names an attempt and it settles nothing else.
It never decides which outcome is current, because [assessment currency](viewer.html?p=mission-service.md) governs that.

## evaluation attempt

One try at the evaluation of a level.
An evaluation has a durable lifecycle, and one evaluation attempt is one try inside that lifecycle.

Continue the objective above, and replace step 5 and step 6.

1. A `reviewer@1` instance claims the objective. Evaluation attempt 1 starts.
2. The reviewer instance becomes unreachable and publishes no assessment. Evaluation attempt 1 ends.
3. The evaluation is incomplete. The level attempt stays open.
4. A bounded retry resumes the evaluation. Evaluation attempt 2 starts.
5. Evaluation attempt 2 publishes the assessment.

One level attempt holds two evaluation attempts.
This example shows why the two terms name different objects.
An evaluation attempt ends while its level attempt stays open.

## assessment

The record of one evaluation of one evidence set against one criteria revision.
An assessment names five things.

- the evidence set that it evaluates
- the criteria revision that it evaluates against
- every immutable child outcome record that it weighs
- the method that it applies
- the actor that performs it

The [overview](viewer.html?p=overview.md) gives what an assessment establishes.
That set is closed and it holds three values.

- The results meet the validation criteria.
- The results do not meet the validation criteria.
- The available evidence establishes neither.

Take the objective "Add password reset" above.
A `reviewer@1` instance evaluates that objective, and it writes one assessment.
That assessment names the evidence set of the objective, the pinned criteria revision, and the outcome record of each task.
It names the evaluation method, and it names the reviewer instance as the actor.
Assessments accumulate, so a second assessment of the same objective never overwrites the first.

## criteria revision

One version of the criteria of a level.
A criteria change preserves the identity of its level and creates a criteria revision.
The term names no closed set.

Continue the objective "Add password reset".

- An import creates the objective, with criteria revision 1.
- A `tdd@1` instance claims the objective. Attempt 1 pins criteria revision 1.
- A human changes the verification command, then imports the plan again. Criteria revision 2 exists.
- Attempt 1 stays on revision 1, because an import never retargets an active attempt.
- A later attempt claims under revision 2.

The identifier of the objective stays the same across both revisions.

## currency

The property of an assessment that three checks admit.
The set of checks is closed and it holds three members.

- **context**: Context asks whether the assessment matches its evidence, its criteria, the structure and the selected child outcomes.
- **authority**: Authority asks whether the assessment still affects current state after an intervening block, unblock, cancellation or override.
- **order**: Order selects the latest assessment that the context check and the authority check admit.

An assessment is current only when all three checks admit it.
The record order answers the order check alone.
A `reviewer@1` instance writes one assessment of "Add password reset".
A new outcome record of one task then fails the context check of that assessment.
That assessment is not current, and it stays in the record.

## edge kind

The kind of an edge of the mission graph. The set is closed and it holds two values.

- **containment**: Every task belongs to exactly one objective. Every objective belongs to exactly one initiative. An initiative is a root of the graph.
- **dependency**: A dependency relates an initiative or an objective. The dependency entry below gives its own two kinds.

Containment descends from a parent to a child, so a containment edge alone forms no cycle.
An edge kind is not a dependency kind. The two sets are different.

## dependency

A graph relation that controls the availability of a level or the timing of its repository actions.
A dependency carries a kind.
The set of kinds is closed and it holds two values.

- **start dependency**: A start dependency makes its dependent unavailable until the level that it names holds a current successful outcome. A human override that asserts success satisfies it. It establishes only what the criteria of the named level establish.
- **landing dependency**: A landing dependency never makes its dependent unavailable. It delays every repository action in the subtree of its dependent until the level that it names lands. An observed landing satisfies it, and a human override never satisfies it. Preparation, local validation and the successful outcome of a task proceed while it waits.

Nothing else is a dependency kind.
A dependency relates an initiative or an objective, and a task carries no dependency edge.
A start dependency determines availability, and a landing dependency gates an operation.

Take a second objective "Add password reset email" that depends on "Add password reset".

- Under a start dependency, "Add password reset email" stays unavailable until "Add password reset" holds a current successful outcome.
- Under a landing dependency, "Add password reset email" stays available, and its repository actions wait for the merge of "Add password reset". Another dependency of that objective still makes it unavailable.

## landing observation

The platform action that observes a landing.
It happens after the run releases, so an authorized observer writes it.
It uses the credential of a repository binding.
The term names no closed set.

Continue step 3 and step 4 of the attempt example.

- Run 1 opens the pull request of the objective "Add password reset", then releases.
- A human merges that pull request.
- The observer performs the platform action, and it observes the merged state.
- The observation retrieves the landed commit identities and appends them to the evidence set.
- The objective becomes available for review.

## landing record

The record of a landing observation.
A landing record names six things.

- the repository action
- the expected end state
- the platform object
- the observed state
- the observation time
- the commit identities

Take the landing observation above, under a repository strategy that requires a pull request for every change.

- repository action: open a pull request
- expected end state: the merged pull request on the git platform
- platform object: the pull request of "Add password reset"
- observed state: merged
- observation time: the time of the platform action
- commit identities: the landed commit of "Add password reset"

## import

The snapshot reconciliation that writes the structure and the criteria of a mission.
`mission-service.md` states three effects on a level, and it closes no set of effects.

- **create**: A plan file that carries no identifier creates a level.
- **update**: A plan file that carries an identifier updates that level.
- **retirement**: A level that the import set omits retires. No plan file carries that effect, because the omission carries it.

One import applies any mix of the three effects, and the import is atomic.
The import set is authoritative.
An import declares its scope, and it names the mission revision that it expects.
The import is the only write path for a level and for a criterion.

## import set

The complete set of levels that one import carries.
A file name is unique inside the import set, and a dependency names a plan file.
The import resolves that name inside the import set, and that dependency carries no path.
The membership changes with each import, so the term names no closed set.

A human keeps the plan of the initiative in markdown, and one import set holds these three files.

- `add-password-reset.md`, the objective
- `add-reset-token-expiry.md`, a task of that objective
- `add-password-reset-email.md`, an objective that names `add-password-reset.md` as a start dependency

The import resolves the name `add-password-reset.md` inside this set.
A level of the declared scope that this set omits retires.

## retirement

The removal of the executable work of a level, with its historical records preserved.
A retirement removes one thing.

- the executable work of its level

A retirement preserves four things.

- the outcomes of that level
- the assessments of that level
- the evidence of that level
- the historical relations of that level

The import that retires a level removes every inbound reference to that level.
A preview confirms every retirement before the import applies.

Take the import set above, and drop the file `add-reset-token-expiry.md`.
The next import retires that task.
The assessment and the evidence of that task stay retrievable.
