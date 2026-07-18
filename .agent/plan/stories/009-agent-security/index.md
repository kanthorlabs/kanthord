# EPIC 009 — Agent security · story index

Epic: `.agent/plan/epics/009-agent-security.md`

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. One story per file, per `AGENTS.md`.

**Authoring status (2026-07-17 — Ulrich-authorized early pass):** exactly ONE
story is authorable now — the executable pi runtime proof (R3 S4). It depends
only on the installed pi packages and the landed EPIC 006 `FakeSessionFactory`,
and on no pending ruling; its OUTPUT is the evidence the D-B/D-C rulings and
EPIC 008's B6 gate design stand on. Every other story's gate is recorded
below. Dispatch note: not through `/work` while the EPIC 006 cycle is active
(shared working tree).

## Stories

1. [Executable pi runtime proof (characterization)](01-pi-runtime-proof.md) —
   **READY (authored)**. Deliberately first: it de-risks the resolution round.
2. Resource lease manager — GATED: D-A ratification (three-part model) + D-H
   (the `blocked` state wires into task parking, whose shape is open).
3. Scoped tool registry + explicit loader — GATED: D-A, D-E (scope
   derivation), D-G (capability-resource representation).
4. Authorization policy (enforced twice) — GATED: D-A + registry/lease
   surfaces + 006 S05 (the runner it hooks into — in flight).
5. Read-prevention profile — GATED: D-B + 006 S05 (tool surface).
6. High-risk tool subprocess host — GATED: D-C.
7. company-db capability + its resources — GATED: D-G + lease manager +
   registry.
8. In-process defense-in-depth (redactor, PathPolicy, InstructionLoader
   hardening) — GATED: 006 S05/S08 land those seams first (in flight;
   hardening what does not exist yet would collide with the 006 lane).
9. End-to-end + hermetic suite — GATED: everything above + D-F sequencing.
