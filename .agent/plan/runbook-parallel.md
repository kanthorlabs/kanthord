# kanthord — Parallel-Execution Runbook (Epics 007–026)

Which epics can run at the same time, and which must wait. Built from the
`## Dependencies` section of each epic file under `.agent/plan/epics/`.
Assumes epics 001–006 are already done.

---

## Rule 0 — Phase gates are hard (no cross-band parallel)

Epics sit in three bands. The bands are **strictly sequential** — you cannot
overlap one band with the next.

| Band | Epics | Gate |
|---|---|---|
| Phase 1 tail | 007–010 | closes on Epic **010** green |
| Phase 2A | 011–019 | **011** starts only after 010; **019** is the exit gate |
| Phase 2B | 020–026 | **020** starts only after 019 passes |

All real parallelism lives **inside** a band.

> `011` and `020` are *setup* epics. Each produces the `SU*` findings that every
> sibling in its band needs, so treat them as the band's single root — nothing
> in the band starts until its setup epic is done.

---

## Phase 1 tail (007–010)

- **Wave 1: 007 ∥ 008** — both need only 001–006; no link between them.
- **Wave 2: 009** — needs all of 001–008.
- **Wave 3: 010** — needs 001–009.

```
007 ─┐
     ├─► 009 ─► 010
008 ─┘
```

---

## Phase 2A (011–019) — after 011 done

- **Wave 1: 012 ∥ 015** — each needs only 011's findings.
  (015 rides on 007/006 from Phase 1, not on 012.)
- **Wave 2: 013 ∥ 018** — both need 012. (015 finishes here if still running.)
- **Wave 3: 014 ∥ 016 ∥ 017**
  - 014 needs 013 + 012
  - 016 needs 015 + 012 + 013
  - 017 needs 013 + 015
- **Wave 4: 019** — the 2A proof, needs 011–018.

```
011 ─┬─► 012 ─┬─► 013 ─┬─► 014 ─┐
     │        │        ├─► 016 ─┼─► 019
     │        └─► 018 ─┘        │
     └─► 015 ────────────► 017 ─┘
```

---

## Phase 2B slice (020–026) — after 020 done

- **Wave 1: 021 ∥ 022 ∥ 023 ∥ 024** — widest parallel batch; each needs only
  020's findings plus completed 2A epics.
- **Wave 2: 025** — needs 024.
- **026** — in this band, but blocked by **029** (dead-man status field), which
  is outside the 007–026 range. It cannot close until 029 lands.

```
020 ─┬─► 021
     ├─► 022
     ├─► 023
     └─► 024 ─► 025

026 ── blocked on 029 (out of range)
```

---

## Open questions

- **013 store dependency.** Epic 013 lists its store dep as "Epic 003/012".
  This runbook reads that as the *real* store (012), so 013 sits in Wave 2 of
  Phase 2A. If 013 may be built against the 003 seam instead, then **013 could
  join 015 in Wave 1**. Confirm before scheduling.

## Cleanest, safest parallel pairs

- **007 ∥ 008** (Phase 1) — clean, no cross-links.
- **021 ∥ 022 ∥ 023 ∥ 024** (Phase 2B) — clean, no cross-links.
