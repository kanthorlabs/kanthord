# LA2. The credential boundary

Status: `draft`. Base: engine `c864130e`. Parent: [LA](LA-agent-build.md).

## Goal

LA2 proves the two credential rules of `kanthord run agent` that need a Linux host: the hostile environment of L2-AC2 in a network namespace, and the credential source of L2-AC6 under a test user whose home comes from the user database. LA2 adds the Linux CI job `agent-e2e` and these two end-to-end checks over the code that [LA1](LA1-run-skeleton.md) ships. LA2 adds no runtime code.

### Entry state

[LA1](LA1-run-skeleton.md#exit-state) is merged. These parts of LA1 are the base of LA2:

1. `run-agent-auth.ts` holds the default path, the file checks, the entry checks 1 to 6 and the routing metadata mapping of [The `--auth` file](L2-agent-cli.md#the---auth-file).
2. `run-agent-pi.ts` holds rules 1 to 5 of [The pi directory](L2-agent-cli.md#the-pi-directory).
3. `run-agent.ts` makes the run directory R with rules 1, 2 and 4 to 7 of [The run directory](L2-agent-cli.md#the-run-directory). The process and each child get `HOME=R/home` and `TMPDIR=R/tmp`.
4. `run-agent-environment.ts` removes the ambient names and the eight proxy names on the process environment. `run-agent-start.ts` refuses a Node proxy setting with `cli.run.agent.env_proxy`.
5. The e2e support of [LA1-D6](LA1-run-skeleton.md#decisions): the LLM stub `src/apps/cli/e2e-llm-stub-test-support.ts` and the harness `src/apps/cli/e2e-run-agent-test-support.ts`. The harness starts the built `bin/kanthord.mjs` ([LA-D10](LA-agent-build.md#decisions)).

### Exit state

The CI job `agent-e2e` runs L2-AC2 in the network namespace `kanthord-n` and L2-AC6 as the test user `kanthord-e2e`. A later check that needs N or a test user lives in a `src/**/*.linux-test.ts` file and runs in the same job.

## Scope

### Files added

- `src/apps/cli/e2e-run-agent-linux-test-support.ts`: the network namespace N, the test user, the connection set of N, the start of the CLI as the test user.
- `src/apps/cli/e2e-run-agent-linux.linux-test.ts`: the self-test of the job, L2-AC2 and L2-AC6.

### Files changed

- `engine/package.json`: the script `test:agent-e2e`.
- `engine/.github/workflows/ci.yml`: the job `agent-e2e`.
- `engine/tsconfig.build.json`: `src/**/*.linux-test.ts` joins `exclude`.
- `engine/eslint.config.js`: `*.linux-test.ts` joins each test-file pattern, so that the lint treats a Linux test file as a test file:
  - the `fileInternalPath` patterns of the import rules at lines 339, 412, 490 and 596;
  - the `files` lists at lines 922 and 941;
  - the `ignores` lists at lines 951, 965, 1086 and 1105.

### Files moved or deleted

None.

### Lint scope

The scope follows [L3-D39](L3-agent.md#decisions). The new files are test files and test support files, so they stay out of the file list of `kanthord/no-inline-object-type`. LA2 changes no `.ts` file of `src/` that is not a test file.

## Pull requests

Each pull request is one engine pull request into `feature/agent-v2` ([LA How each pull request ships](LA-agent-build.md#how-each-pull-request-ships)). Each PR passes `pnpm run verify` in `engine` and the CI jobs `check`, `e2e` and `agent-e2e`.

### PR 1. The Linux test job

- Files: `e2e-run-agent-linux-test-support.ts`, the self-test in `e2e-run-agent-linux.linux-test.ts`, `test:agent-e2e`, the job `agent-e2e`, `tsconfig.build.json`, `eslint.config.js`.
- The job `agent-e2e` runs on `ubuntu-latest` with the Node version of `.nvmrc`. Its steps:
  1. Install the dependencies. Run `pnpm run build` and `pnpm run pi-tools:fetch`.
  2. Run `sudo useradd --create-home --home-dir /home/kanthord-e2e kanthord-e2e`. The home of this user is H of L2-AC6.
  3. Run `sudo ip netns add kanthord-n`, `sudo ip -n kanthord-n link set lo up` and `sudo ip -n kanthord-n route add local 0.0.0.0/0 dev lo` (BD1).
  4. Load an nft table in N with a dynamic set `connections` of `ipv4_addr . inet_service`. One output rule adds each new connection to the set.
  5. Give the test user read access with `setfacl` to the checkout, the pnpm store and the Node directory, and search access to each parent directory (BD2).
  6. Run `sudo ip netns exec kanthord-n sudo -u "$(id -un)" env "PATH=$PATH" pnpm --silent run test:agent-e2e` (BD3).
- `test:agent-e2e` runs `test:files` on `src/**/*.linux-test.ts` with `--test-concurrency=1`.
- The Linux support uses the stub and the fixtures of LA1. It adds three functions:
  - start `bin/kanthord.mjs` as `kanthord-e2e` with `sudo -n -u` and an explicit environment (BD4);
  - write a fixture file as that user with mode `0600` (BD5);
  - read the set `connections` with `nft -j` (BD6).
- Makes pass: the self-test (BD7). The stub answers a scripted request in N, and the set holds the address and port of the stub. A connection to `192.0.2.1:443` fails, and the set holds it. `os.userInfo().homedir` of the test user is H. The test user starts `bin/kanthord.mjs`, reads each pi tool and writes a fixture file with mode `0600`.
- Verify: `pnpm run verify` on macOS; the job `agent-e2e` on the PR. The self-test passes only when the runner allows `ip netns`, `nft`, `useradd` and `setfacl` through `sudo`: it runs in N, reads the set, and starts Node as the test user from the checkout.
- `main` works: the PR adds test infrastructure only. `pnpm run verify` does not run a `.linux-test.ts` file, and the build does not emit it.

### PR 2. The Linux end-to-end checks

- Files: L2-AC2 and L2-AC6 in `e2e-run-agent-linux.linux-test.ts`.
- Makes pass: the two checks of [Acceptance checks](#acceptance-checks).
- Verify: the job `agent-e2e` on the PR.
- `main` works: the PR adds tests only. A defect that a check finds is fixed in the LA1 module in this PR. The fix makes a rule match L2 and never accepts more than L2.

## Acceptance checks

Each check starts the built CLI as a process, with a real file system, real git and the real pi runtime. The LLM stub of LA1 on loopback is the only stub. The fixtures, commands and asserts are the text of [L2 Checks](L2-agent-cli.md#checks). This section adds only the build details.

1. **[L2-AC2](L2-agent-cli.md#checks).** File: `e2e-run-agent-linux.linux-test.ts`. Job: `agent-e2e`, so the process runs in N.
   - Stub2 is a second instance of the LLM stub on loopback. The assert reads its connection count.
   - The harness starts the process with an explicit environment that holds the markers of the check.
   - "N logs connections only to Stub": the set `connections` gains only the address and port of Stub during the two runs.
   - The digest listings of H, P and Auth use SHA-256 over the sorted output of `find`.
2. **[L2-AC6](L2-agent-cli.md#checks).** File: `e2e-run-agent-linux.linux-test.ts`. Job: `agent-e2e`.
   - The process runs as `kanthord-e2e`, so the user database gives H `/home/kanthord-e2e`.
   - The harness writes Auth, `H/.pi/agent/auth.json`, `H/.config/kanthord/cli.yaml`, D2, H2 and X2 as that user, mode `0600`.
   - The harness writes the credential JSON of the check to the standard input of the process.
   - Each variant has its own W, S and D. The harness removes `H/.config` and `H/.pi` after the check.

An agent runs each check with no human step: the job `agent-e2e` runs both.

## Unit-level rules

None. LA2 adds no runtime module.

## Credential statement

The rows of [LA1 Credential statement](LA1-run-skeleton.md#credential-statement) give the strength after LA1. LA2 changes no rule. It proves four rules end to end:

1. **The default `--auth` path.** The user database gives the home, and `HOME`, `XDG_CONFIG_HOME` and `PI_CODING_AGENT_DIR` do not change the path. L2-AC6.
2. **Credential sources.** `run agent` reads no standard input, no variable and no other `auth.json`. L2-AC6 and L2-AC2.
3. **Ambient removal and proxy names.** No marker and no proxy name reaches a request or a child process, and N records no connection other than to Stub. L2-AC2.
4. **Child environment.** A child gets only the names of L2. L2-AC2.

Proof for each PR:

- PR 1 changes no shipped code.
- PR 2 adds tests only, plus the fix of a defect that a check finds.

No PR of LA2 weakens a rule.

## Handoff

### To LA3

- None. LA3 adds no check that needs N or a test user.

### To LA5

- The job `agent-e2e`, its support and the test user `kanthord-e2e` run the L4 checks.

## Decisions

1. **LA2-D1.** LA2 has 2 PRs in this order: the Linux job, the Linux end-to-end checks. Constraint: LA2 adds no runtime code; a defect that a check finds is fixed in the LA1 module.
2. **LA2-D2.** A check that needs N or a test user lives in a `src/**/*.linux-test.ts` file. Constraint: only `test:agent-e2e` runs it; `pnpm run verify` and the build skip it; each test-file pattern of `eslint.config.js` covers it.
3. **LA2-D3.** The job `agent-e2e` runs the test command inside the network namespace `kanthord-n`, with only loopback up. Constraint: an nft set in N records each new connection by address and port; L2-AC2 reads the set.
4. **LA2-D4.** The test user is `kanthord-e2e` with the home `/home/kanthord-e2e`. Constraint: the harness starts the CLI and writes the fixture files of L2-AC6 as that user.
5. **LA2-D5.** The Linux support extends the LA1 stub and harness and holds no second stub. Constraint: its file name ends in `test-support.ts`, so the build excludes it.

## Build details

### PR 1

1. **BD1. N has a local default route on loopback.** Step 3 adds `local 0.0.0.0/0 dev lo`. Each IPv4 address is then local to N. A connection attempt passes the nft output hook, the set records it, and the attempt fails at once with `ECONNREFUSED` when no process listens. Constraint: without a route, or with a `blackhole` route, `connect` fails before the output hook, and the set records nothing. Only loopback is up, as LA2-D3 states.
2. **BD2. The test user reads three trees.** Step 5 gives `kanthord-e2e` the ACL `rX` on the checkout, on the directory that `pnpm store path` prints, and on the Node directory of `process.execPath`. It gives the ACL `x` on each parent directory of the three. Constraint: the step runs after the build and after `pi-tools:fetch`, so `dist`, `node_modules` and `.pi-tools` are in the grant. The grant is read-only.
3. **BD3. Step 6 passes `PATH` through `env`.** `sudo` finds a command only in its `secure_path`, so `sudo ... --preserve-env=PATH pnpm` does not find pnpm. Step 6 runs `env "PATH=$PATH" pnpm` as the runner user, and names the user with `id -un`.
4. **BD4. The CLI of the test user starts through `env -i`.** `spawnBinAsTestUser` runs `sudo -n -u kanthord-e2e env -i NAME=value ... <process.execPath> bin/kanthord.mjs`. The process gets exactly the given names, with no name that `sudo` adds. `spawnCliAsTestUser` calls it with the arguments and the environment of the LA1 harness (`runAgentArguments`, `cliEnvironment`). Constraint: an environment value is visible in the argument list, so a check passes only a marker there. The credential K stays in a file.
5. **BD5. A fixture file never has a wider mode.** `writeFileAsTestUser` runs `sh` as the test user with `umask 077`. It makes the parent directories, writes the standard input to the path, and sets the mode `0600`.
6. **BD6. The set is a list of address and port.** `nftConnections` parses the output of `sudo -n nft -n -j list set ip kanthord connections` and returns each element as `{ address, port }`. A check compares the exact pair.
7. **BD7. The self-test has six tests.** They are: the stub request in N with the stub pair in the set; the refused connection to `192.0.2.1:443` with its pair in the set; `os.userInfo().homedir` from Node as the test user; `bin/kanthord.mjs --version` as the test user; read and execute access to `fd` and `rg`; a fixture file with mode `0600`, owner and text.
8. **BD8. The job installs `nftables` and `acl` when the runner lacks `nft` or `setfacl`.**
9. **BD9. Two more places treat a Linux test file as a test file.** `workerTestFiles` of `eslint.config.js` holds the `*.linux-test.ts` patterns of the worker directories. `scripts/health.mjs` counts a `.linux-test.ts` file as a test file, not as a production file.
10. **BD10. PR 1 changes the LA1 harness.** `e2e-run-agent-test-support.ts` exports `ENGINE_ROOT`, `BIN_PATH`, `runAgentArguments` and `cliEnvironment`. `spawnCli` uses them, so the Linux support holds no second copy of the command line (LA2-D5).

### To PR 2

- L2-AC6 writes a credential JSON to the standard input of the process. `spawnBinAsTestUser` closes the standard input today. PR 2 adds the input to `TestUserStart`.
- W, S, D, X and T of L2-AC6 must be writable by `kanthord-e2e`. `buildFixtures` makes them as the runner user under a `0700` directory. PR 2 makes them as the test user.
- N has no name resolution, and the rule records TCP only. A connection attempt by host name fails before `connect`, so the set does not show it.

### PR 2

1. **BD11. DNS recording.** PR 2 adds `ip protocol udp udp dport 53 add @connections { ip daddr . udp dport }` to the nft output chain. The existing TCP rule already covers TCP port 53. The self-test sends a UDP datagram to `192.0.2.53:53` and asserts the pair appears in the set.
2. **BD12. nft set snapshot before the run.** The set accumulates entries across all tests in the job. L2-AC2 takes a snapshot of the set before each two-run block and diffs after to identify new connections. It asserts only the stub's address and port appear in the delta.
3. **BD13. L2-AC2 uses `spawnCli`.** The CLI runs as the test runner user inside N (the whole job is in N). `hostiletEnv` builds the hostile environment from markers and stub2's URL. `withoutAmbientCredentials` strips all markers and proxy names from `process.env` before the LLM client initialises.
4. **BD14. L2-AC6 uses `spawnBinAsTestUser`.** Each variant creates its own W and D as the test user via `mkdirAsTestUser` and `buildWorkspaceAsTestUser`. The auth file at `H/.config/kanthord/auth.json` holds K. `defaultAuthPath()` reads `userInfo().homedir` = `/home/kanthord-e2e` regardless of `HOME` or `XDG_CONFIG_HOME` in the environment.
5. **BD15. Session files are root-readable.** L2-AC6 reads session files owned by `kanthord-e2e` via `sudo cat` (GitHub Actions runners have NOPASSWD sudo). The test asserts no decoy key appears in any session file.
6. **BD16. `noAuth` option on `RunOptions`.** PR 2 adds `noAuth?: boolean` to `RunOptions` and updates `runAgentArguments` to skip `--auth` when `noAuth` is true. L2-AC6 uses it via `spawnBinAsTestUser` directly (no `--auth` arg, so `defaultAuthPath()` applies).
7. **BD17. L2-AC2 bash tool check.** The stub returns a tool call `bash { command: "env; cat ~/.aws/credentials" }` for each of the two runs. L2-AC2 reads the `toolResult` entries in both session files and asserts no marker text appears in any bash output block. The child HOME is `R/home` (the run directory home), not `H`, so `~/.aws/credentials` resolves to a non-existent path and the marker file at `H/.aws/credentials` is not reachable from the bash tool.
