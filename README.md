# kanthord
> Kanthor's agentic program does the work with an opinionated setup. The D mean daemon, same meaning in systemd :D

## TODO

- **Modify an on-going TDD cycle (in-flight epic/story amendment).** Today the
  plan tree is locked once a `/work` cycle starts: engineers cannot touch the
  Epic/Story files, and a mid-cycle correction has to route through a review
  finding or a decision record. But in daily work the requirement can change at
  any time — a review can reveal a missing behavior (e.g. Epic 008's B2:
  the deploy executor was never wired to be scheduler-driven), or the human can
  decide to change scope while the cycle is running. We need a first-class,
  supported way to **amend an in-flight epic/story** and re-enter the loop
  without breaking the lane locks or the review/decision record — instead of
  ad-hoc appending a follow-up epic (as we do now with `008.1`). Requirement:
  a modification can be proposed, reviewed (debate), and merged into the active
  plan, and the running cycle picks it up as new RED work with a clear audit
  trail of what changed and why.
