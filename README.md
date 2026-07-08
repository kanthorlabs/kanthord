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

- **Internet Exposure.** Allow developers to visualize the app running on localhost
  from the internet. Options: tunnel solution (Cloudflare Tunnel, ngrok, etc.) or
  direct Cloudflare infrastructure to push a site for quick review.

- **Asset Preview.** Once Internet Exposure is available, publish markdown or HTML
  artifacts directly instead of plaintext — faster review turnaround, better UI/visual
  feedback for designs and documentation.

- **Context Engineer.** We should have a table mapping for feature we build,
  then AI can quickly understand the context of the project and provide better suggestions.
  Then we need to adapt Long-Term, Short-Term memory techniques because
  we need temporary context memory (Short-Term memory) while we build the feature,
  then later turn it into Long-Term memory for future reference. 