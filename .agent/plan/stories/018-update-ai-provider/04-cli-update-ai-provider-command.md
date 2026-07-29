# Story S4 — `kanthord update ai-provider`

Epic: `.agent/plan/epics/018-update-ai-provider.md`
Depends on: Story S3 (the use case)

## Change

- `src/apps/cli/ai-provider.ts` — add `runUpdateAiProvider` beside the other
  runners (place it after `runRegisterAiProvider`, which ends at `:88`):

```ts
export async function runUpdateAiProvider(
  args: Record<string, unknown>,
  updateAiProvider: UpdateAiProvider,
  io: {
    tty?: NodeJS.ReadStream;
    timeoutMs?: number;
    stdin?: NodeJS.ReadableStream;
  } = {},
): Promise<HandlerResult>;
```

- Read `id` with `requireFlag(args, "id")`.
- Read the config flags with the **camelCase** key convention this file already
  uses (`runRegisterAiProvider:20-88`): `model`, `baseUrl`, `effort`, `api`,
  `contextWindow`, `maxTokens`, `allowInsecure`. Parse `contextWindow` and
  `maxTokens` with `parseInt(..., 10)` exactly as register does at its
  numeric-flag lines.
- When `args["valueFile"]` is a non-empty string, read the secret with
  `readCredentialValue({valuefile, tty: io.tty, stdin: io.stdin, timeoutMs})`
  where `timeoutMs = parseValueTimeout(args["value-timeout"]) ?? io.timeoutMs ?? 180_000`.
  `parseValueTimeout` is currently private to `src/apps/cli/resource.ts:21-30`
  — export it from there and import it here rather than copying it.
  Map a `CredentialReadTimeoutError` and any other read `Error` to
  `{exitCode: 1, stdout: [], stderr: ["error: …"]}` exactly as
  `runUpdateCredential` does at `src/apps/cli/resource.ts:298-313`.
- Call `updateAiProvider.execute({...})`, spreading only the defined keys
  (the `...(x !== undefined ? { x } : {})` idiom used throughout this file —
  required by `exactOptionalPropertyTypes`).
- Success → `{ exitCode: 0, stdout: [id], stderr: [`ai-provider updated: ${id} (${changed.join(", ")})`] }`.
- Wrap everything in the file's standard
  `catch (err) { const mapped = toResult(err); return { ...mapped, stdout: [] }; }`.
- New leaf `src/apps/cli/commands/update/ai-provider.ts`, modelled on
  `src/apps/cli/commands/update/credential.ts` (whole file, 54 lines):
  - `new Command("ai-provider").description("Update a registered AI provider.")`
  - `.configureHelp({ commandUsage: () => "kanthord update ai-provider" })`
  - `.requiredOption("--id <id>", "ID of the AI provider to update")`
  - `.option()` for: `--model <model>`, `--base-url <url>`, `--effort <effort>`,
    `--api <flavor>`, `--context-window <n>`, `--max-tokens <n>`,
    `--allow-insecure`, `--value-file <path|->`, `--value-timeout <duration>`.
    **No `--name` and no `--provider` option** — their absence is what makes the
    immutable fields unreachable, and commander then fails an unknown option.
  - `.addHelpText("after", "\nExample:\n  kanthord update ai-provider --id aip-1 --model gpt-5.6-terra\n")`
    — the architecture test requires both `Usage` and `Example` in help.
  - The action builds `const reader = { tty: process.stdin.isTTY ? process.stdin : undefined, stdin: process.stdin }`
    (copied from `update/credential.ts:35-38`) and calls
    `emitResult(await runUpdateAiProvider({...opts, "value-timeout": opts.valueTimeout}, deps.updateAiProvider, reader), io)`.
- `src/apps/cli/commands/update.ts` — add `"updateAiProvider"` to the
  `UpdateDeps` `Pick<>` union (`:10-16`) and
  `command.addCommand(buildUpdateAiProviderCommand(deps, io));` after the
  existing four `addCommand` calls (`:27-30`), with the matching import beside
  `:5-8`.
- `src/apps/cli/deps.ts` — add `import type { UpdateAiProvider } from "../../app/ai-provider/update-ai-provider.ts";`
  beside `:56-66`, and `updateAiProvider: UpdateAiProvider;` to `CliDeps` after
  `registerAiProvider` (`:235`).
- `src/composition.ts` — construct
  `const updateAiProvider = new UpdateAiProvider(aiProviderRegistry, unitOfWork, modelCatalog);`
  after `registerAiProvider` (`:260-266`), and add `updateAiProvider,` to the
  returned deps object beside `registerAiProvider` (`:1212-1222`).
- `src/apps/cli/architecture.test.ts` — bump the two hard-coded counters and
  append the changelog note in the doc comment at `:27`:
  - `:28` `EXPECTED_LEAF_FILE_COUNT = 72` → `73`
  - `:43` `EXPECTED_LEAF_COUNT = 78` → `79`

## Constraints

- **`runUpdateAiProvider` goes in `src/apps/cli/ai-provider.ts`, never in
  `src/apps/cli/resource.ts`.** The guard test
  `src/apps/cli/update-resource.test.ts:162` asserts `resource.ts` exports no
  `runUpdateAiProvider` (008.3 retired the project-scoped resource); it must keep
  passing untouched.
- `index.ts` must gain no `.action(`/`.option(` — the architecture test forbids
  it there.
- The secret must not be echoed: the success line names the changed field names
  only, and `value` appears in `changed` as the literal string `"value"`.
- Exporting `parseValueTimeout` from `resource.ts` is the only permitted edit to
  that file.

## Verify

- `src/apps/cli/commands/update.test.ts` — new tests in the existing style
  (`capture()` helper at `:7-24`, deps as an object literal cast
  `as unknown as Parameters<typeof buildUpdateCommand>[0]`, driven with
  `.parseAsync([...], { from: "user" })`):
  - `update ai-provider --id aip-1 --model m2` calls `execute` with exactly
    `{ id: "aip-1", model: "m2" }` and emits
    `["ai-provider updated: aip-1 (model)\n"]` on stderr with exit code 0;
  - `--value-file -` with a `PassThrough` stdin (the stdin-stubbing pattern at
    `:27-64`) passes the read secret through as `value`, and the captured
    stdout+stderr contain neither the secret nor the string `value-file`;
  - `--name x` and `--provider y` exit non-zero as unknown options;
  - `--context-window 8` reaches the use case as the **number** `8`, not the
    string `"8"`;
  - the help text contains `Usage` and `Example`.
- `src/apps/cli/ai-provider.test.ts` — a runner-level test that a thrown
  `NoUpdateFieldsError` becomes `{exitCode: 1}` with an `error: `-prefixed
  stderr line and empty stdout.
- `node --test src/apps/cli/commands/update.test.ts src/apps/cli/ai-provider.test.ts src/apps/cli/architecture.test.ts src/apps/cli/update-resource.test.ts`
  passes.
- `node src/main.ts update ai-provider --help` prints the command.
- `npm run verify` exits 0.
- Proof: phases B, D, E and F of `scripts/e2e/update-ai-provider-proof.sh`.
