# Story S1 — the token layer: six role properties + an exhaustive role map

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md` (decision 7, `docs/ui-design.md:279-299`)

## Change

### 1. `ui/src/index.css` — six role custom properties

Delete the placeholder comment at `ui/src/index.css:3-10` (the block that says the role tokens are "NOT defined here").

Add the six roles to the existing `:root` block (`ui/src/index.css:14-43`), after `--radius`, using `oklch()` like every neighbour:

```css
--role-neutral: oklch(0.556 0 0);
--role-active: oklch(0.588 0.158 241.966);
--role-attention: oklch(0.769 0.188 70.08);
--role-blocked: oklch(0.554 0.135 66.442);
--role-danger: oklch(0.577 0.245 27.325);
--role-success: oklch(0.596 0.145 163.225);
```

Add the same six keys to the existing `.dark` block (`ui/src/index.css:45-73`) with lighter values:

```css
--role-neutral: oklch(0.708 0 0);
--role-active: oklch(0.707 0.165 254.624);
--role-attention: oklch(0.828 0.189 84.429);
--role-blocked: oklch(0.666 0.126 66.442);
--role-danger: oklch(0.704 0.191 22.216);
--role-success: oklch(0.696 0.17 162.48);
```

Add six aliases to the existing `@theme inline` block (`ui/src/index.css:75-107`), after the last `--color-sidebar-*` entry:

```css
--color-role-neutral: var(--role-neutral);
--color-role-active: var(--role-active);
--color-role-attention: var(--role-attention);
--color-role-blocked: var(--role-blocked);
--color-role-danger: var(--role-danger);
--color-role-success: var(--role-success);
```

The `--role-*` properties live in `:root`/`.dark` (not inside `@theme`) so they always resolve on `document.documentElement`; the `@theme inline` aliases are what generate the `text-role-*` / `bg-role-*` / `border-role-*` utilities.

### 2. New file `ui/src/lib/status-role.ts`

Exports, exactly these names:

```ts
export const ROLES = [
  "neutral",
  "active",
  "attention",
  "blocked",
  "danger",
  "success",
] as const;
export type Role = (typeof ROLES)[number];

/** `--role-neutral` … — the custom property S1 declares in ui/src/index.css. */
export function roleVar(role: Role): string;

/** Complete literal Tailwind classes. Never interpolate a role into a class name. */
export const ROLE_CLASS = {
  neutral: "border-role-neutral/40 bg-role-neutral/10 text-role-neutral",
  active: "border-role-active/40 bg-role-active/10 text-role-active",
  attention:
    "border-role-attention/40 bg-role-attention/10 text-role-attention",
  blocked: "border-role-blocked/40 bg-role-blocked/10 text-role-blocked",
  danger: "border-role-danger/40 bg-role-danger/10 text-role-danger",
  success: "border-role-success/40 bg-role-success/10 text-role-success",
} satisfies Record<Role, string>;
```

Then the seven axes. Each axis declares its own union (the UI's own copy — EPIC 026.1 decision 8; the HTTP views widen most of these to `string` on the wire) and its role map with `satisfies Record<…, Role>`:

```ts
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_confirmation"
  | "discarded";
export const TASK_STATUS_ROLE = {
  pending: "neutral",
  running: "active",
  completed: "success",
  failed: "danger",
  awaiting_confirmation: "attention",
  discarded: "neutral",
} satisfies Record<TaskStatus, Role>;

export type InitiativeStatus = "building" | "landed" | "discarded";
export const INITIATIVE_STATUS_ROLE = {
  building: "active",
  landed: "success",
  discarded: "neutral",
} satisfies Record<InitiativeStatus, Role>;

export type DependencyState = "ready" | "blocked";
export const DEPENDENCY_STATE_ROLE = {
  ready: "success",
  blocked: "blocked",
} satisfies Record<DependencyState, Role>;

export type ExecutionState = "runnable" | "paused";
export const EXECUTION_STATE_ROLE = {
  runnable: "active",
  paused: "attention",
} satisfies Record<ExecutionState, Role>;

/** `blockedForever` is a boolean on the wire (src/apps/http/views/task.ts:68). */
export const BLOCKED_FOREVER_ROLE = {
  true: "danger",
  false: "neutral",
} satisfies Record<"true" | "false", Role>;
export function roleForBlockedForever(value: boolean): Role;

/** The readiness axis is ConfigCheckStatus ∪ DaemonStatus — ten members. */
export type ReadinessCheckStatus =
  | "ok"
  | "unverified"
  | "missing"
  | "paused"
  | "blocked"
  | "failed"
  | "unsupported"
  | "running"
  | "stopped"
  | "multiple";
export const READINESS_CHECK_STATUS_ROLE = {
  ok: "success",
  unverified: "attention",
  missing: "attention",
  paused: "attention",
  blocked: "blocked",
  failed: "danger",
  unsupported: "neutral",
  running: "success",
  stopped: "attention",
  multiple: "danger",
} satisfies Record<ReadinessCheckStatus, Role>;

export type ProbeStatus = "ok" | "failed";
export const PROBE_STATUS_ROLE = {
  ok: "success",
  failed: "danger",
} satisfies Record<ProbeStatus, Role>;
```

Publication takes no role value (`docs/ui-design.md:294-296`). Add exactly:

```ts
export type PublicationState = "unpublished" | "published" | "diverged";
export interface Publication {
  readonly state: PublicationState;
  readonly remoteOID: string | null;
}
/**
 * published + remoteOID → `published@<oid>`; published with a null oid →
 * `published`; any other state → the state itself.
 */
export function publicationLabel(publication: Publication): string;
```

Source-of-truth anchors for the member lists (do not re-derive, do not scrape at test time):
`src/domain/task.ts:4-13`, `src/domain/initiative.ts:4-6`,
`src/app/initiative/get-initiative-graph.ts:93-94`,
`src/app/project/project-readiness.ts:17-31` and `:125-129`,
`src/app/resource/resource-view.ts:31-34`.

## Constraints

- Objective status (`building`/`awaiting_confirmation`/`conflict`/`integrated`/`discarded`, `src/domain/initiative.ts:8-16`) is **not** one of the seven axes the epic lists. Do not add it.
- Every class in `ROLE_CLASS` is a complete literal string. No template interpolation anywhere, in this file or its consumers — Tailwind v4 scans source text and an interpolated name generates no CSS.
- `status-role.ts` imports nothing. It is pure data plus three pure functions.
- Do not import anything from `src/` into `ui/` and do not read `src/apps/http/views/*.ts` at test time (decision 8).
- `verbatimModuleSyntax` is on: any type-only import in the test must be `import type`.
- **Why `:root` and not inside `@theme`** — settled in epic decision 7 (amended 2026-07-31). Tailwind v4 emits only the theme variables a build actually uses, so six `--role-*` keys declared inside `@theme` can be tree-shaken out of the served CSS and Proof phase F (which reads them on `document.documentElement`) would fail intermittently. `:root`/`.dark` plus `@theme inline` aliases keeps them always present, keeps dark mode working, and still generates the `role-*` utilities. `@theme static` is the rejected alternative. This is the same layering the file already uses for `--background` → `--color-background` (`ui/src/index.css:14-43` and `:75-107`).

## Verify

- New test file `ui/src/lib/status-role.test.ts`, run with `npm run ui:test`. It asserts:
  - `ROLES` has exactly the six members `neutral, active, attention, blocked, danger, success`, in that order.
  - `roleVar(r)` returns `--role-${r}` for each of the six roles, and every return value is a non-empty string starting with `--role-`.
  - `Object.keys(ROLE_CLASS)` equals `ROLES`, and every value is a non-empty string containing `text-role-` + that role name.
  - For each of `TASK_STATUS_ROLE`, `INITIATIVE_STATUS_ROLE`, `DEPENDENCY_STATE_ROLE`, `EXECUTION_STATE_ROLE`, `BLOCKED_FOREVER_ROLE`, `READINESS_CHECK_STATUS_ROLE`, `PROBE_STATUS_ROLE`: the sorted key list equals the exact member list written above, and every value is a member of `ROLES`.
  - `roleForBlockedForever(true) === "danger"` and `roleForBlockedForever(false) === "neutral"`.
  - `publicationLabel({state:"published", remoteOID:"deadbeef"}) === "published@deadbeef"`;
    `publicationLabel({state:"published", remoteOID:null}) === "published"`;
    `publicationLabel({state:"unpublished", remoteOID:null}) === "unpublished"`;
    `publicationLabel({state:"diverged", remoteOID:"abc"}) === "diverged"`.
  - Publication carries no role: `"publication"` and `"published"` are keys of none of the seven role maps.
- `npm run ui:typecheck` exits 0 — the `satisfies` clauses are the exhaustiveness guard; removing a key must fail it.
- `npm run verify` exits 0.
- Proof: none directly; S1 supplies the `--role-*` properties that Proof **phase F** reads on `document.documentElement`.
