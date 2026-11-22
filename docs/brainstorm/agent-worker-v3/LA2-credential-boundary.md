# LA2. The credential boundary

Status: `draft`. Base: engine `c864130e`. Parent: [LA](LA-agent-build.md).

## Goal

LA2 proves the credential boundary of `kanthord run agent` end to end and closes its last gap to [L2](L2-agent-cli.md). It adds the Linux test job, the removal of the proxy names and the refusal of a Node proxy setting. It adds the end-to-end checks L2-AC2, L2-AC5, L2-AC6, L2-AC7 and L2-AC14 over the code that [LA1](LA1-run-skeleton.md) ships. LA2 builds no second `--auth` reader, no second run directory and no second pi directory check.

### Entry state

[LA1](LA1-run-skeleton.md#exit-state) is merged. These parts of LA1 are the base of LA2:

1. `run-agent-auth.ts` holds the default path, the file checks, the entry checks 1 to 6 and the routing metadata mapping of [The `--auth` file](L2-agent-cli.md#the---auth-file) ([LA1 PR9](LA1-run-skeleton.md#pull-requests)).
2. `run-agent-pi.ts` holds rules 1 to 5 of [The pi directory](L2-agent-cli.md#the-pi-directory). The `auth.json` refusal runs before the pi tool install.
3. `run-agent.ts` makes the run directory R with rules 1, 2 and 4 to 7 of [The run directory](L2-agent-cli.md#the-run-directory) ([LA1 PR10](LA1-run-skeleton.md#pull-requests)). The process and each child get `HOME=R/home` and `TMPDIR=R/tmp`.
4. The `run agent` copy of `withoutAmbientCredentials` removes the names of today on the process environment ([LA1 Scope](LA1-run-skeleton.md#files)). The proxy names stay.
5. `openAgent` adds the allowlist and the confinement of the profile to each session ([LA1 Credential statement](LA1-run-skeleton.md#credential-statement)).
6. The e2e support of [LA1-D6](LA1-run-skeleton.md#decisions): the LLM stub `src/apps/cli/e2e-llm-stub-test-support.ts` and the harness `src/apps/cli/e2e-run-agent-test-support.ts`. The harness starts the CLI entry `src/main.ts` ([LA1-D5](LA1-run-skeleton.md#decisions)).

### Exit state

A user runs `kanthord run agent` in an environment that sets `HTTPS_PROXY` or `https_proxy`. The run removes each proxy name before pi loads, so no model request and no child process sees a proxy. A user who sets `NODE_USE_ENV_PROXY`, or `--use-env-proxy` in `NODE_OPTIONS` or `process.execArgv`, gets the refusal `cli.run.agent.env_proxy` with exit `1`. The engine CI runs L2-AC2 and L2-AC6 in a network namespace with a test user. `pnpm run verify` runs L2-AC5, L2-AC7 and L2-AC14.

## Scope

### Files added

- `src/apps/cli/run-agent-start.ts` and `run-agent-start.test.ts`: the [proxy settings](L2-agent-cli.md#proxy-settings), [L2 unit-level rule 8](L2-agent-cli.md#unit-level-rules).
- `src/apps/cli/e2e-run-agent-linux-test-support.ts`: the network namespace N, the test user, the connection set of N, the start of the CLI entry as the test user.
- `src/apps/cli/e2e-run-agent-linux.linux-test.ts`: the self-test of the job, L2-AC2 and L2-AC6.
- `src/apps/cli/e2e-run-agent-boundary.test.ts`: L2-AC5, L2-AC7 and L2-AC14.

### Files changed

- The `run agent` copy of `withoutAmbientCredentials` and its test: rule 3 of [The run directory](L2-agent-cli.md#the-run-directory).
- `src/apps/cli/run-agent.ts`: step 1 of the [run order](L2-agent-cli.md#run-order) calls the proxy check after the `--token` refusal.
- The code list of `run agent`: `cli.run.agent.env_proxy`, class `terminal`, with the rows of [Proxy settings](L2-agent-cli.md#proxy-settings).
- `engine/docs/cli/run.md`: the proxy names and the refusal.
- `engine/package.json`: the script `test:agent-e2e`.
- `engine/.github/workflows/ci.yml`: the job `agent-e2e`.
- `engine/tsconfig.build.json`: `src/**/*.linux-test.ts` joins `exclude`.
- `engine/eslint.config.js`: `src/**/*.linux-test.ts` joins the test file globs at lines 922 and 941.

### Files moved or deleted

None.

### Lint scope

The scope follows [L3-D39](L3-agent.md#decisions). The counts are union members, property object types and string literal property types.

- `run-agent-start.ts` and `e2e-run-agent-linux-test-support.ts` are new (0, 0, 0). The PR that adds each file adds it to the file list of `kanthord/no-inline-object-type`.
- `run-agent.ts` and the module of the ambient removal are in the list since LA1.
- LA2 changes no `.ts` file of `src/` at `c864130e`.

## Pull requests

Each PR is one engine pull request and one root pointer pull request ([LA How each step ships](LA-agent-build.md#how-each-step-ships)). Each PR passes `pnpm run verify` in `engine`. From PR 1, each PR also passes the CI jobs `check`, `e2e` and `agent-e2e`.

### PR 1. The Linux test job

- Files: `e2e-run-agent-linux-test-support.ts`, the self-test in `e2e-run-agent-linux.linux-test.ts`, `test:agent-e2e`, the job `agent-e2e`, `tsconfig.build.json`, `eslint.config.js`.
- The job `agent-e2e` runs on `ubuntu-latest` with the Node version of `.nvmrc`. Its steps:
  1. Install the dependencies. Run `pnpm run build` and `pnpm run pi-tools:fetch`.
  2. Run `sudo useradd --create-home --home-dir /home/kanthord-e2e kanthord-e2e`. The home of this user is H of L2-AC6.
  3. Run `sudo ip netns add kanthord-n` and `sudo ip -n kanthord-n link set lo up`.
  4. Load an nft table in N with a dynamic set `connections` of `ipv4_addr . inet_service`. One output rule adds each new connection to the set.
  5. Give the test user read access to the checkout with `setfacl`.
  6. Run `sudo ip netns exec kanthord-n sudo -u "$USER" --preserve-env=PATH pnpm --silent run test:agent-e2e`.
- `test:agent-e2e` runs `test:files` on `src/**/*.linux-test.ts` with `--test-concurrency=1`.
- The Linux support uses the stub and the fixtures of LA1. It adds three functions: start the CLI entry as `kanthord-e2e` with `sudo -n -u` and an explicit environment; write a fixture file as that user with mode `0600`; read the set `connections` with `nft -j`.
- Makes pass: the self-test. Stub answers a scripted request in N. A connection to `192.0.2.1:443` fails, and the set holds it. `os.userInfo().homedir` of the test user is H.
- Verify: `pnpm run verify` on macOS; the job `agent-e2e` on the PR.
- `main` works: the PR adds test infrastructure only. `pnpm run verify` does not run a `.linux-test.ts` file, and the build does not emit it.

### PR 2. The proxy rules

- Files: `run-agent-start.ts` and its test; the ambient removal and its test; `run-agent.ts`; the code list; `run.md`.
- Rules:
  1. Step 1 refuses `NODE_USE_ENV_PROXY` with any value, the row `variables: NODE_USE_ENV_PROXY`.
  2. Step 1 refuses the token `--use-env-proxy` in `NODE_OPTIONS`, the row `variables: NODE_OPTIONS`.
  3. Step 1 refuses `--use-env-proxy` in `process.execArgv`, the row `option: --use-env-proxy`.
  4. The `--token` refusal stays first.
  5. Step 6 also removes `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY`, in upper and lower case.
- Makes pass: [L2 unit-level rule 8](L2-agent-cli.md#unit-level-rules); [L1 U14](L1-model.md#unit-level-rules); the removal of the eight proxy names in the test of the ambient removal.
- Verify: `pnpm --silent run test:files src/apps/cli/run-agent-start.test.ts` and the test of the ambient removal.
- `main` works: the PR adds a refusal and removes more names. The LA1 checks set no proxy name.

### PR 3. The end-to-end checks of the boundary

- Files: `e2e-run-agent-boundary.test.ts` (L2-AC5, L2-AC7, L2-AC14); `e2e-run-agent-linux.linux-test.ts` (L2-AC2, L2-AC6).
- Makes pass: the five checks of [Acceptance checks](#acceptance-checks).
- Verify: `pnpm --silent run test:files src/apps/cli/e2e-run-agent-boundary.test.ts`; the job `agent-e2e` for L2-AC2 and L2-AC6.
- `main` works: the PR adds tests only. A failed check names a defect of LA1 or PR 2, and the fix joins this PR.

## Acceptance checks

Each check starts the CLI entry as a process, with a real file system, real git and the real pi runtime. The LLM stub of LA1 on loopback is the only stub. The fixtures, commands and asserts are the text of [L2 Checks](L2-agent-cli.md#checks). This section adds only the build details.

1. **[L2-AC2](L2-agent-cli.md#checks).** File: `e2e-run-agent-linux.linux-test.ts`. Job: `agent-e2e`, so the process runs in N.
   - Stub2 is a second instance of the LLM stub on loopback. The assert reads its connection count.
   - The harness starts the process with an explicit environment that holds the markers of the check.
   - "N logs connections only to Stub": the set `connections` gains only the address and port of Stub during the two runs.
   - The digest listings of H, P and Auth use SHA-256 over the sorted output of `find`.
2. **[L2-AC5](L2-agent-cli.md#checks).** File: `e2e-run-agent-boundary.test.ts`. It runs in `pnpm run verify` and the CI job `check`.
   - `<marker>` is a path in `$TEST`. The assert reads it with `lstat` and expects `ENOENT`.
3. **[L2-AC6](L2-agent-cli.md#checks).** File: `e2e-run-agent-linux.linux-test.ts`. Job: `agent-e2e`.
   - The process runs as `kanthord-e2e`, so the user database gives H `/home/kanthord-e2e`.
   - The harness writes Auth, `H/.pi/agent/auth.json`, `H/.config/kanthord/cli.yaml`, D2, H2 and X2 as that user, mode `0600`.
   - The harness writes the credential JSON of the check to the standard input of the process.
   - Each variant has its own W, S and D. The harness removes `H/.config` and `H/.pi` after the check.
4. **[L2-AC7](L2-agent-cli.md#checks).** File: `e2e-run-agent-boundary.test.ts`. It runs in `pnpm run verify` and the CI job `check`.
   - Variant 2 commits `.pi/extensions/x.ts` and `AGENTS.md` in W before the run. M7 and M9 are paths in `$TEST`.
5. **[L2-AC14](L2-agent-cli.md#checks).** File: `e2e-run-agent-boundary.test.ts`. It runs in `pnpm run verify` and the CI job `check`.
   - The marker file lies in `$TEST`, outside W. A block result is a `toolResult` entry of S with `isError` `true`.

An agent runs each check with no human step: `pnpm run verify` in `engine` for L2-AC5, L2-AC7 and L2-AC14, and the job `agent-e2e` for L2-AC2 and L2-AC6.

## Unit-level rules

- [L2 rule 8](L2-agent-cli.md#unit-level-rules), the start checks, with [L1 U14](L1-model.md#unit-level-rules): `src/apps/cli/run-agent-start.test.ts`.
- The removal of the eight proxy names: the test of the `run agent` copy of `withoutAmbientCredentials`.

## Credential statement

The rows of [LA1 Credential statement](LA1-run-skeleton.md#credential-statement) give the strength after LA1. LA2 changes two rows and proves five rules end to end.

1. **Proxy names and Node proxy setting.** LA1: the names stay, and no refusal applies, as today. LA2: the removal of the eight names and the `env_proxy` refusal ([L2-D19](L2-agent-cli.md#decisions)). Stricter.
2. **Ambient removal.** LA1: the list of today on the process environment, with `HOME=R/home`. LA2: the same list plus the eight proxy names. Stricter.
3. **The `--auth` file conditions, the `!` and `$` refusals and the default path.** LA1 holds them. LA2 proves them with L2-AC5 and L2-AC6. Kept.
4. **Credential sources.** LA1 reads no standard input and no variable. LA2 proves it with L2-AC6 and L2-AC2. Kept.
5. **Credential file in the pi directory and extension loads.** LA1 refuses `auth.json` before the install. LA2 proves it with L2-AC7. Kept.
6. **Child environment.** LA1 gives a child only the names of L2. LA2 proves it with L2-AC2. Kept.
7. **Confinement.** LA1 adds it to each confined profile. LA2 proves it with L2-AC14. Kept.
8. Each other row of LA1 is kept.

Proof for each PR:

- PR 1 changes no shipped code.
- PR 2 adds a refusal and removes more names from the process environment.
- PR 3 adds tests only, plus the fix of a defect that a check finds. A fix makes a rule match L2 and never accepts more than L2.

No PR of LA2 weakens a rule.

## Handoff

### To LA3

- `run-agent-start.ts` holds the proxy checks of L2 rule 8 after LA2. LA3 adds the call of the start preconditions of L3 at step 9 in its own place, and leaves the proxy checks at step 1.
- The Linux job `agent-e2e` and its support are open to a later check that needs N or a test user.

### To LA4

- The `run agent` copy of the ambient removal holds its own name list since LA1. LA4 deletes the copy of `tasks run` with no effect on LA2.

### Items in another sub-layer

1. [LA1 To LA3](LA1-run-skeleton.md#to-la3) names `run-agent-start.ts` for the start preconditions. The [module table of LA](LA-agent-build.md#module-files-of-the-l2-rules) gives `run-agent-start.ts` to L2 rule 8, the proxy checks. LA2 adds the file with rule 8. The start preconditions of L3 have their own module, `src/agent/start-preconditions.ts`.
2. L2-AC14 needs no LA2 code. LA1 ships the confinement in `openAgent`. The check stays in LA2 as the split puts it.

## Decisions

1. **LA2-D1.** LA2 has 3 PRs in this order: the Linux job, the proxy rules, the end-to-end checks of the boundary. Constraint: LA2 builds no second `--auth` reader, run directory or pi directory check; a defect that a check finds is fixed in the LA1 module.
2. **LA2-D2.** A check that needs N or a test user lives in a `src/**/*.linux-test.ts` file. Constraint: only `test:agent-e2e` runs it; `pnpm run verify` and the build skip it; the lint globs of test files cover it. Each other LA2 check runs in `pnpm run verify`.
3. **LA2-D3.** The job `agent-e2e` runs the test command inside the network namespace `kanthord-n`, with only loopback up. Constraint: an nft set in N records each new connection by address and port; L2-AC2 reads the set.
4. **LA2-D4.** The test user is `kanthord-e2e` with the home `/home/kanthord-e2e`. Constraint: the harness starts the CLI entry and writes the fixture files of L2-AC6 as that user.
5. **LA2-D5.** The Linux support extends the LA1 stub and harness and holds no second stub. Constraint: its file name ends in `test-support.ts`, so the build excludes it.
6. **LA2-D6.** `run-agent-start.ts` holds L2 rule 8. Constraint: the proxy checks run at step 1, after the `--token` refusal and before each option check.
