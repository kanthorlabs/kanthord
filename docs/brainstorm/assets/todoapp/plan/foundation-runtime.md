---
kind: task
parent: foundation.md
bindings: []
verifications:
  - node --test test/foundation-runtime.test.js
  - npm ci && npm run test:foundation
  - npm run lint && npm run format:check
---
# Provide a reproducible Node 24 runtime

## Requirement

Keep an ESM package, Node 24 version declaration, lockfile, runtime guard and a side-effect-free Express app factory. Provide development and start commands and the `lint`, `format:check` and `test:foundation` scripts. Keep source modules small and inject external resources.

## Criterion

- Tests prove constructing and importing the app does not listen on a port or open a database.
- The runtime check accepts major 24 and rejects another major using a testable version input.
- The package lock matches the manifest; a clean install and static checks succeed without disabling lint rules to hide defects.
- `test/foundation-runtime.test.js` contains behavioral assertions and closes every resource it opens.
