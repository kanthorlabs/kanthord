# KanthorD

A long-running daemon that executes software-engineering work across your
repositories on your behalf — you define the work graph, agents run it, and you
step in only where a human is required.

## Documentation

- **[Git Workflow](git-workflow.md)** — how kanthord moves code from an agent's
  edits to your remote: the bare managed home, per-initiative branches,
  one-commit-per-objective, and the explicit publish step.
- **[Format spec — graph-md](formats/graph-md.md)** — the markdown format for
  importing a work graph (initiatives, objectives, tasks).

## Per-epic architecture views

Snapshots of what exists after each epic — command surface, static
architecture, runtime flow, and state machines:

- [001 — Development environment](flowchart/001.md)
- [002 — Domain core](flowchart/002.md)
- [003 — Persistence, queue & event feed](flowchart/003.md)
- [004 — CLI manages the work graph](flowchart/004.md)
- [005 — Execution loop with a fake agent](flowchart/005.md)
- [006 — Real agents via pi](flowchart/006.md)
