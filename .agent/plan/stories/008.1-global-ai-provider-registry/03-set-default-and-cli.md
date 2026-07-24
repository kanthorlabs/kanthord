# Story C — `set-default` use case + read/register CLI

Epic: `.agent/plan/epics/008.1-global-ai-provider-registry.md`
Depends on: Story A (registry), Story B (`RegisterAiProvider`).

## Change

### Use cases (`src/app/ai-provider/`)

- **`get-ai-provider.ts`** — `class GetAiProvider { constructor(private registry:
AiProviderRegistry) } execute(id): AiProviderView` → `registry.get(id)`;
  undefined → `throw new UnknownReferenceError("ai_provider", id)`; else map to a
  view (below).
- **`list-ai-providers.ts`** — `class ListAiProviders { execute(): AiProviderView[] }`
  → `registry.list()` mapped to views, `isDefault = (p.id === registry.getDefaultId())`.
- **`set-default-ai-provider.ts`** — `class SetDefaultAiProvider { execute(id):
void }`: `const p = registry.get(id)`; undefined → `UnknownReferenceError`;
  `if (p.state !== "active") throw` a typed `LoggedOutProviderError(id)` (new
  class in `src/app/ai-provider/errors.ts`); else `registry.setDefaultId(id)`.
- **View** — `src/app/ai-provider/ai-provider-view.ts`: `AiProviderView`
  hand-lists `{ id, name, provider, model, baseUrl, effort, state, isDefault }`
  and **omits `value`** (structural-omission redaction, mirror
  `resource-view.ts:79-89` — never spread the record). No read path returns
  `value`.
- Add `LoggedOutProviderError` to the `instanceof` chain in
  `src/apps/cli/error-map.ts:42-67` (import it) so it maps to exit-1, not a crash.

### CLI runners (`src/apps/cli/ai-provider.ts`, new — mirror `resource.ts`)

Each returns `CliResult = { exitCode, stdout, stderr }` (id on stdout, friendly on
stderr; try/catch → `toResult(err)` with `stdout: []`):

- `runRegisterAiProvider(args, deps, reader)`: reads the secret via
  `readCredentialValue({ valuefile: args["value-file"], tty, stdin, timeoutMs })`
  (see `resource.ts:130-135`), calls `deps.registerAiProvider.execute({name,
provider, model, baseUrl, effort, value})`; `stdout:[id]`,
  `stderr:["ai-provider registered: "+id]`.
- `runListAiProviders(args, deps)`: `deps.listAiProviders.execute()`; `--json` →
  `stdout:[JSON.stringify(views)]`, else a human table; **no `--project`**.
- `runGetAiProvider(args, deps)`: requires `--id`; `deps.getAiProvider.execute(id)`;
  `--json` → `stdout:[JSON.stringify(view)]`.
- `runSetDefaultAiProvider(args, deps)`: requires `--id`;
  `deps.setDefaultAiProvider.execute(id)`; `stdout:[id]`,
  `stderr:["default ai-provider set: "+id]`.

### CLI commands

- New verb file `src/apps/cli/commands/register.ts` (grouping, copy the
  `preSubcommand` shape from `commands/login.ts:7-19`) + leaf
  `commands/register/ai-provider.ts`: `new Command("ai-provider")`,
  `.requiredOption("--name <name>")`, `.requiredOption("--provider <id>")`,
  `.requiredOption("--model <id>")`, `.option("--base-url <url>")`,
  `.option("--effort <level>")`, `.option("--value-file <path|->")`,
  `.action(o => emitResult(await runRegisterAiProvider(…), io))`.
- New verb file `src/apps/cli/commands/set-default.ts` + leaf
  `commands/set-default/ai-provider.ts`: `.requiredOption("--id <id>")`.
- New leaf `src/apps/cli/commands/get/ai-provider.ts` under the existing `get`
  verb: `.requiredOption("--id <id>")`, `.option("--json")`.
- **Repurpose** `list ai-provider` to GLOBAL — `src/apps/cli/commands/list/resource.ts:43-49`:
  replace the `buildListAiProviderCommand` body so it builds a **global**
  `new Command("ai-provider")` with `.option("--json")` and **no**
  `--project`, calling `runListAiProviders`. (Do not route it through
  `buildListResourceCommand`.)
- Register the two new verbs in `src/apps/cli/index.ts`: import
  `buildRegisterCommand` / `buildSetDefaultCommand` (lines 5-27), `.name()` them
  (38-56), and `.addCommand()` them (65-85).

### Wiring

- `src/apps/cli/deps.ts` (interface lines 117-183): add `registerAiProvider:
RegisterAiProvider;`, `listAiProviders: ListAiProviders;`, `getAiProvider:
GetAiProvider;`, `setDefaultAiProvider: SetDefaultAiProvider;` (import the types).
- `src/composition.ts`: construct all four (`new RegisterAiProvider({registry:
aiProviderRegistry, unitOfWork, modelCatalog, newId})`, etc. — `unitOfWork`
  already built for other use cases; `modelCatalog` at line 194) and add them to
  the returned bundle literal (lines 666-719).

### Test counters

- `src/apps/cli/architecture.test.ts`: set `EXPECTED_LEAF_FILE_COUNT = 56`
  (line 28) and `EXPECTED_LEAF_COUNT = 58` (line 31) — this story adds 3 leaf
  files (`register/ai-provider.ts`, `set-default/ai-provider.ts`,
  `get/ai-provider.ts`); `list ai-provider` is repurposed, not added.
- `src/apps/cli/commands/read.test.ts:587-616`: replace the project-scoped
  `list ai-provider --project` expectation with the global one — assert
  `list ai-provider --json` calls `deps.listAiProviders.execute()` (no
  `projectId`) and prints the JSON views.

## Constraints

- No read path (`list`/`get`, human or `--json`) may emit `value` — assert this.
- `set-default` rejects a `logged_out` target (`LoggedOutProviderError`).
- Keep the daemon and project-scoped `create/update ai-provider` untouched (those
  are retired in 008.3).

## Verify

- New `src/app/ai-provider/set-default-ai-provider.test.ts`,
  `get-ai-provider.test.ts`, `list-ai-providers.test.ts` (fake registry):
  set-default rejects unknown id + logged_out id, sets active id; get/list map
  views with correct `isDefault` and **no `value`** field.
- New `src/apps/cli/ai-provider.test.ts` (CLI, `capture()` + fake deps, template
  `commands/create.test.ts`): register returns id on stdout + friendly stderr;
  `list --json` prints views without `value`; `get --id --json`; `set-default
--id`; a rejected set-default → exit 1 + `error:` stderr.
- `npm run verify` exits 0 (architecture counts updated).
- Proof (008.1 Proof block): delivers **PASS A/B** (register two → first is sole
  default via `list --json`), **PASS C** (`set-default` flips), **PASS D-coexist**
  (two `openai-codex` records distinct), and the **leak gate** (no `SECRET` in
  `register`/`list`/`get`/`set-default` output).
