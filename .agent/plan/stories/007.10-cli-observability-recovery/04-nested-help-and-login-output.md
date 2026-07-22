# Story D — nested `--help` + `login provider` output consistency (F5, F6)

Epic: `.agent/plan/epics/007.10-cli-observability-recovery.md`

Two independent papercuts from run `e2e-0710`. Both are display/output-only;
neither changes command behavior.

## Item D1 — nested `<group> <sub> --help` prints the subcommand's help (F5)

**Why:** `create ai-provider --help`, `get conflict --help`, `run daemon
--help`, `retry task --help` all print root help (`Usage: kanthord [options]
[command]`) instead of the subcommand's help. `login provider --help` DOES
print correct sub help — so the working wiring exists in one group and is just
not applied uniformly.

**What's there:** `login` (`src/apps/cli/commands/login.ts:7-19`) sets
`.showHelpAfterError()` and a `.hook("preSubcommand", (_parent, child) =>
child.copyInheritedSettings(command))` (:13-15); each leaf sets custom usage +
examples via `.configureHelp({commandUsage})` / `.addHelpText("after", …)`
(e.g. `login/provider.ts:11,19-22`). The exploration reports the same
`preSubcommand` + `copyInheritedSettings` shape already present in `get.ts`,
`retry.ts`, `run.ts`, `create.ts`, `list.ts` — so the RED test must first
pin down which piece is actually missing/misordered for the groups that regress
(the reported symptom is real; the wiring diff is what the test isolates).

**Contract:** `<group> <sub> --help` prints `Usage: kanthord <group> <sub> …`
(the subcommand's own help) for **every** command group, proven across the
matrix — at minimum `get conflict`, `create ai-provider`, `run daemon`,
`retry task`. `login provider --help` stays correct (regression guard). The
`<group> help <sub>` form keeps working.

**Test:** `node --test` (extend the CLI/architecture test that already knows the
command matrix, e.g. `src/apps/cli/architecture.test.ts`): for each `(group,
sub)` pair, invoke `<group> <sub> --help` and assert the first output line
starts `Usage: kanthord <group> <sub>` — not root usage. Include the
`login provider` regression guard.

## Item D2 — `login provider` emits `credential created: <id>` on stderr (F6)

**Why:** every `create …` resource command prints `<kind> created: <id>` on
stderr with the id on stdout (canonical form `src/apps/cli/project.ts:12` /
`resource.test.ts:153-167`), but `login provider` (`runLogin` in
`src/apps/cli/login.ts:21-78`) returns `{stdout:[credId], stderr:[]}` (:74) —
bare id, no confirmation line. Output-convention drift for a resource-creating
command.

**Contract:** on success `runLogin` returns `stdout:[credId]` (unchanged — the
bare id on stdout preserves script-friendly command substitution) **and**
`stderr:["credential created: <credId>"]`, matching the `create credential`
contract. No change to the OAuth flow, input validation (:34-51), or exit code.

**Test:** `node --test` on the login path (with the OAuth flow faked, as the
existing login test does): success returns stdout `[credId]` and a stderr line
`credential created: <credId>`. This unit test is what the epic Proof relies on
for D2 — `login provider` cannot run hermetically, so the Proof asserts D2 only
via `--help`.

## Constraints

- Both items are display/output-only and independent; land in any order.
- Surgical: D1 touches only command-group `--help` wiring; D2 adds one stderr
  line. No change to command behavior, exit codes, or stdout.

## Verification Gate

- The `node --test` targets above (D1 matrix, D2 login stderr) pass.
- `npm run verify` exits 0.
- Delivers the epic's **Proof D / D2** (nested `--help` shows the subcommand's
  help for get/create/run/retry; `login provider --help` unchanged).
