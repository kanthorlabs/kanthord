# TypeScript / Node 24 type-stripping gotchas

Living checklist. **Read before any `src/` edit.** These are the pitfalls
verified during EPIC 001 planning on Node 24.12 with type stripping + ESM.

- **Relative imports need explicit `.ts` extensions.** Under type stripping,
  Node does not rewrite extensions. Write `import { x } from "./greeting.ts"`,
  not `"./greeting"`. `allowImportingTsExtensions` in `tsconfig.json` lets `tsc`
  accept this.

- **`verbatimModuleSyntax` → `import type` is required for type-only imports.**
  A value import of something used only as a type is an error, and a type
  imported without `type` is emitted as a runtime import (which then fails).
  Ports are types: `import type { StatusStore } from "../../storage/port.ts"`.

- **Builtins use the `node:` prefix form.** `import { test } from "node:test"`,
  `import assert from "node:assert/strict"`, `import { DatabaseSync } from
  "node:sqlite"`. The bare form (`"test"`) is not resolved the same way.

- **Top-level `await` is fine in ESM.** No IIFE wrapper needed in `main.ts`.

- **`node:sqlite` prints an `ExperimentalWarning` to stderr but exits 0**
  (verified on 24.12). Do **not** treat stderr noise as failure and do **not**
  add stderr filtering. The Proof contract is exit 0 + stdout, not empty stderr.

- **TypeScript parameter properties are NOT supported in strip-only mode**
  (verified on 24.12: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Do not write
  `constructor(private readonly store: X) {}`. Declare the field explicitly
  (`readonly #store: X;` or `private readonly store: X;`) and assign it in the
  constructor body. The same restriction hits `enum` and namespaces — prefer
  union types / plain objects.

- **`noUncheckedIndexedAccess` types indexed access as `T | undefined`.**
  `arr[0]` is `T | undefined`; a `SELECT count(*)` row read by index/key must be
  narrowed before use (guard or assert the shape).
