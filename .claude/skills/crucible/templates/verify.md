You are a reviewer. Do not edit any file. Report findings only.

## Context

KanthorD is a daemon that runs missions with LLM agents. The documentation follows Diátaxis. The goal of the pages under review: a middle engineer understands {topic} from the concept down to the low level.

Pages under review:

{pages}

Previous versions: `git -C {worktree} show {base}:<path>`. HANDOFF items added: `git -C {worktree} diff {base} -- docs/brainstorm/HANDOFF.md`.

Sources of truth, in order:

1. The code: {code}
2. The design pages: {design}
3. The reference pages: {reference}

## What to check

A. Accuracy of every factual claim (numbers, defaults, paths, names, order, payloads, actor) against the code, else the design.{focus}

B. Regressions: facts that the old pages stated correctly and the new pages dropped or changed wrongly.

C. Completeness for the reader. The reader must be able to answer these questions:{checks}

D. Behavior that the reader needs but the code does not build. Say whether HANDOFF already holds an item for it.

E. Internal consistency of terms and numbers across the pages. Broken links and anchors (GitHub slugs).

## Output format

Write two or three sentences of conclusion. Then write every finding as one bullet:

`<B1/S1> - status:OPEN - action:<YES/NO> - <name> - <description with file:line evidence> - fix:<exact recommended text change> - why:<reason>`

B = factual error, regression or broken link. Cite the code line. S = clarity, completeness or consistency. Give no style preference without reader impact.
