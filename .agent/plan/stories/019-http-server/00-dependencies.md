# Story 00 — dependencies + `.env.example` (maintainer, DONE)

Epic: `.agent/plan/epics/019-http-server.md` (bullet S0)

**Not for `/work`.** `package.json`, `package-lock.json` and `.env.example` are
lane-forbidden to every role (`scripts/lane-check.sh`). Ulrich + Aelita completed
this in a normal session on 2026-07-29, before dispatch.

## Change (already applied — verify only, do not repeat)

- `package.json` dependencies: `koa` `3.2.1`, `pino` `10.3.1`,
  `@koa/bodyparser` `6.1.0`, `@koa/cors` `5.0.0`. `find-my-way` removed.
- `package.json` devDependencies: `supertest` `7.2.2`, `@types/koa` `3.0.3`,
  `@types/koa__cors` `5.0.1`, `@types/supertest` `7.2.1`.
- `.env.example` at the repo root documenting `API_KEY=` with the
  `openssl rand -hex 32` hint and the 16-character minimum.

## Verify

- `node -e 'const p=require("./package.json"); for (const k of ["koa","pino","@koa/bodyparser","@koa/cors"]) if (!p.dependencies[k]) throw new Error(k)'`
  exits 0.
- `test -f .env.example` exits 0.
- Proof: none directly; every later story depends on this.
