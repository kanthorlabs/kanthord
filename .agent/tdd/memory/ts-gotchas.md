# TypeScript / ESM gotchas (read before any TS edit)

Living checklist. Append a dated bullet when a new pitfall bites.

- **Explicit `.ts` import extensions.** Node 24 runs TS via type stripping; a
  relative import MUST carry the real on-disk extension: `import { greet } from
  "./greeting.ts"`. `tsconfig` has `allowImportingTsExtensions: true` for this.
  An extensionless or `.js` relative import will fail at runtime.
- **`verbatimModuleSyntax` is on.** Use `import type { Foo }` for type-only
  imports; a value import used only as a type is an error. Do not mix.
- **`node:` builtins.** Import core modules with the `node:` prefix
  (`node:test`, `node:assert/strict`, `node:fs/promises`). `@types/node` must be
  installed for the type-check to resolve them.
- **`noUncheckedIndexedAccess` is on.** Array/record index access yields
  `T | undefined`; narrow before use.
- **No emit.** The build is type-check only (`tsc --noEmit`); there is no `dist/`
  yet. Run code with `node src/x.ts` directly.
- **No TypeScript parameter properties.** Node 24 type stripping does NOT support
  the `constructor(private readonly foo: string) {}` shorthand — it is a
  TypeScript-only transformation (not a mere annotation), so the stripper rejects
  it at runtime with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Always use an explicit
  field declaration + manual assignment in the constructor body instead.
