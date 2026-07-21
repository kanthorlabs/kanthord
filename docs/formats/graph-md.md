# Format spec — graph-md (EPIC 007)

A markdown-based format for authoring and exporting the kanthord work graph
(Initiative → Objective → Task hierarchy). The format is a **projection**
(export) and a **proposal** (import); the database remains the single source of
truth.

## File structure

One file per node; a package is a directory tree of `.md` files plus an
optional `.kanthord-export.json` manifest.

```
<package-root>/
  <initiative>.md            # kind: initiative
  <objective>/
    <objective>.md           # kind: objective
    <task>.md                # kind: task
    …
  …
  .kanthord-export.json      # present on exported packages only
```

Directory/file names and locations are **cosmetic** (B18). Identity comes from
frontmatter `id`; parentage from the frontmatter parent reference.

## Frontmatter (fixed key order)

```yaml
---
kind: initiative | objective | task
id: <ULID> # present on exported / post-handoff nodes (omit for authored)
ref: <slug> # present on authored nodes (omit when id is already the ref)
# objective only:
initiative: <ULID-or-slug>
# task only:
objective: <ULID-or-slug>
name: <string> # initiative / objective
title: <string> # task
agent: <string> # task; absent → generic@1
dependencies: [<ULID-or-slug>, …] # task; absent → []
---
```

### Reference grammar (B6)

- **ULID**: 26-char uppercase Crockford base-32 — `^[0-9A-HJKMNP-TV-Z]{26}$`
  (case-SENSITIVE; no I/L/O/U).
- **Ref**: lowercase slug — `^[a-z0-9][a-z0-9-]{0,63}$`.
- The two sets are **disjoint by case** — shape decides kind with no DB lookup.
- A ULID-shaped but unknown-in-DB value is always an error, never treated as
  a ref.

### Effective ref

- Exported node (has `id:`): effective ref = `id` value (ULID-as-ref).
- Authored node (has `ref:`, no `id:`): effective ref = `ref` value.
- Post-handoff created node: carries both `id:` and `ref:`; effective ref =
  `ref`.

## Body sections (task only)

### `# Instructions`

Multi-line prose. The only section that may span multiple lines.

### `# Acceptance Criteria`

Checklist items, one per line:

```markdown
- [ ] returns 200 for valid credentials
- [ ] rejects invalid credentials with 401
```

Each item is **single-line** (newlines inside an item are invalid; enforced by
domain rule B12).

### `# Verification`

One fenced `sh` block, one command per line. Adaptive fence length (longer
backtick run when content contains one). **Absent section = unset** (`undefined`);
**empty fence = explicit clear** (`[]`).

```markdown
# Verification

\`\`\`sh
npm test
\`\`\`
```

## Canonical bytes (B9)

- Fixed frontmatter key order (as above).
- LF line endings.
- `- [ ] ` checklist prefix.
- Single trailing newline.
- `dependencies` serializes as a sorted set; `ac`/`verification` as ordered lists.

## Manifest (`.kanthord-export.json`)

Present only on exported packages:

```json
{
  "initiativeId": "<ULID>",
  "packageId": "<ULID>",
  "formatVersion": 1,
  "digestAlgorithm": "sha256",
  "nodes": { "<id>": "<sha256>", … },
  "files": ["<id>", …],
  "refToId": {
    "objectives": { "<ref>": "<id>", … },
    "tasks": { "<ref>": "<id>", … }
  }
}
```

- `nodes`: full snapshot of initiative + objectives + tasks sha256 tokens (TS1).
- `files`: ids written as `.md` files — the delete-eligibility set (TB1),
  separate from `nodes`.
- `refToId`: kind-scoped ref→id mapping (B6; objective and task namespaces
  never collide).
