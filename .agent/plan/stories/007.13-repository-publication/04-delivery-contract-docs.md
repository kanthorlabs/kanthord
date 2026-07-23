# Story D — delivery-contract documentation

Epic: `.agent/plan/epics/007.13-repository-publication.md`
Docs only; land last. Maintainer-lane.

## Change

Add a short **delivery-contract** section to `README.md` and `AGENTS.md`:

- task `completed` + candidate `landed` (007.8) / objective `integrated`
  (007.12) == **locally landed** in the bare managed home.
- delivery to the remote is the explicit `publish repository` step (007.13),
  human-gated, fast-forward-only, with state `unpublished` / `published@<remoteOID>`
  / `diverged`.
- the deferred `pr@1` agent (007.12) will call `publish`; until then, publish is
  manual.

One paragraph + the state list. Match existing tone; don't restructure adjacent
sections.

## Verify

- `README.md` / `AGENTS.md` contain the section (grep for `publish` +
  `locally landed` + the three states).
- `npm run verify` exits 0.
