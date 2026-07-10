# Feedback — Phase-3 backlog: custom tools need a classification contract first

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Parking here for Phase-3 scoping.

kanthord blocks unknown effectful tools fail-closed — correct, keep it.
pi's `registerTool` extensibility must NOT be opened until a classification
contract exists: a new tool ships with its ring-1 class (pure/effectful) and
a declared way to extract its path arguments, or it stays blocked. The
contract is the extension point; enforcement code stays fixed. Until then,
"extend by data and registries, not by code inside ring-1" remains the
posture.
