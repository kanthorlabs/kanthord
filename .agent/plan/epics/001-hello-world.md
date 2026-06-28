# EPIC 001 — Hello World (pipeline smoke)

**Outcome.** A trivial pure function exists and is covered by `node:test`, proving
the four-role TDD pipeline (test-engineer → software-engineer → reviewer-engineer)
and the toolchain (`tsc --noEmit`, `node --test`, `verify:handoff`) run
end-to-end. This EPIC exists only to exercise the pipeline; it ships no product
behavior.

**Non-goals.** No file store, no gRPC, no config — none of the Core subsystems.
Do not introduce dependencies.

## Stories

- `001-hello-world/greeting` — a `greet(name)` function.

## Verification Gate

All in-scope tests green and the type-check clean:

```
npm run typecheck   # tsc --noEmit, exit 0
npm test            # node --test, exit 0
```
