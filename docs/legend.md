---
title: Conventions
---

# Conventions

This page defines how to read, write, and link every other page in this documentation set.

---

## 1. Viewer URL shape

Open a page with `viewer.html?p=<filename>.md`. Use the URL fragment for section anchors: `viewer.html?p=reference.md#node-table`. Never put a filename in the fragment; the fragment is reserved for section IDs.

---

## 2. Status annotation

Annotate status **per claim**. Never annotate per page, per epic, or per feature area. Place the annotation as a compact italic line directly after the claim it qualifies.

State only the dimensions that apply. The three independent dimensions are:

**Observable implementation** — judged by reachability, not by file existence. "Present" means the code path is reachable from the process entry point; it does not assert that all edge cases work as specified:
- `Present at engine <sha>.` — the code path is reachable from the process entry point at that commit.
- `Partial at engine <sha>.` — some paths are reachable; the qualifying cases follow.
- `Absent at engine <sha>.` — the code path is not reachable; the symbol may exist.

**Planning provenance:**
- `In the authored range.` — an authored EPIC covers this claim.
- `Proposal only.` — a proposal exists but no authored EPIC covers it.

**Design qualification:**
- `Unresolved: <what is open>.` — no decision exists on this point.
- `Conflicting: <what conflicts>.` — two sources make incompatible claims.

Include only the dimensions with something to say. Omit a dimension when it is not relevant to the specific claim. Omission means "not relevant here", not "unknown" or "not assessed".

**Examples.** Every example below is a real annotation from this documentation set. Never illustrate a rule with an invented fact.

*Present at engine `c17e718`.*

*Absent at engine `c17e718`. Proposal only. EPIC 055; outside the authored range.*

*Partial at engine `c17e718`. In the authored range. Unresolved: the fence counter reset path.*

*Absent at engine `c17e718`. Proposal only. Conflicting: EPIC 053.1 and EPIC 050.1 name different owners for the `judged_oid` pin, and neither epic states which one the code will follow.*

---

## 3. Status is never conveyed by colour alone

Never use colour as the sole carrier of status. Colour may supplement a text annotation, but it cannot replace one. Never use dashed lines to carry status. Dashed lines are already taken: the agent-facing diagram set in the engine source uses a dashed line for an application invariant the schema does not enforce.

---

## 4. Current behaviour and design intent

Never mix current behaviour and a proposed change in the same unqualified diagram. A proposed change requires a bounded overlay at a real capability boundary, under an explicit heading such as "Not current behaviour — EPIC 055 proposal". Do not invent arrows between separate proposed changes in the same overlay.

---

## 5. One owner per assertion

State each fact on exactly one page. Every other page links to it. Duplicated assertions are the primary cause of drift. When a page contradicts a claim on another page, amend the owning page in the same commit.

---

## 6. Verified-against line

Every page carries an introductory line in the **page body** (not only in front-matter, which the viewer strips from display) that names the engine commit and the source files its claims rest on. Use commit-pinned absolute GitHub URLs:

```
https://github.com/kanthorlabs/kanthord-engine/blob/c17e718/src/domain/node.ts#L42
```

The engine repository `kanthorlabs/kanthord-engine` is **private**. A citation link at that URL resolves only for a reader with access to the private repository. A reader without access receives a GitHub 404. The links stay — the audience is the owner and team engineers — but do not assume a public reader can follow one.

A citation must carry enough text in the page itself to make the claim checkable without following the link. Name the file and the symbol in prose, not only in the href. A reader with no repository access must be able to understand the claim from the page alone; the link is corroboration.

---

## 7. Live legacy

A table, field, or behaviour that currently exists stays documented. Mark it alongside the entry: *"Current; proposed removal in EPIC 057."* Distinguish schema existence from runtime use. Do not replace the entry with a removal notice; place the notice beside the entry.

---

## 8. Claims register

`overview.md` numbers its load-bearing claims with anchored identifiers (`C01`, `C02`, …). Each detail page declares in its front-matter the claim ids it evidences:

```yaml
---
title: Work graph
evidences: [C04, C05]
---
```

A page that contradicts a claim must amend `overview.md` in the same commit.
