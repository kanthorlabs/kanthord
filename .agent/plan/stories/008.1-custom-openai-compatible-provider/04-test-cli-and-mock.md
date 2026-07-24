# Story D — `test ai-provider` CLI + openai-completions mock

Epic: `.agent/plan/epics/008.1-custom-openai-compatible-provider.md`
Depends on: Story C (session reconstruction), `008.3` (resolved-provider session
path / `sessions.for`).

## Change

- **Use case** — `src/app/ai-provider/test-ai-provider.ts`, class
  `TestAiProvider { constructor({ registry, sessions }) }`,
  `execute({ id, prompt }): Promise<string>`:
  1. `const p = registry.get(id)`; undefined → `UnknownReferenceError`.
  2. `const session = await this.#sessions.for(<AIProvider-shape from p>,
<Credential-shape from p>)` (build the two shapes from the resolved provider
     exactly as the daemon does in `008.3` Story A).
  3. Single-turn call — drain `session.streamFn(session.model, { messages:
[{ role: "user", content: [{ type: "text", text: prompt }] }] })`,
     accumulating `event.type === "text_delta"` `delta`s (and, at the terminal
     `done` event, any `TextContent` blocks in `message.content`). Return the
     collected text. No Agent loop, no workspace.
- **CLI** — new verb `src/apps/cli/commands/test.ts` + leaf
  `commands/test/ai-provider.ts`: `.requiredOption("--id <id>")`,
  `.option("--prompt <text>")` (default `"What is today's datetime?"`). Runner
  `runTestAiProvider(args, deps)` in `src/apps/cli/ai-provider.ts` → prints the
  model text on **stdout**; errors → `toResult(err)` exit 1. Register the `test`
  verb in `src/apps/cli/index.ts`; wire `testAiProvider` into `deps.ts` +
  `composition.ts` (`{ registry: aiProviderRegistry, sessions }` where `sessions`
  is the `PiProviderSessionFactory`).
- **Mock fixture** — new `scripts/e2e/mock-openai-completions.mjs`: a Node
  `http.createServer` bound to `127.0.0.1:0`; on `POST /v1/chat/completions`
  respond `200` `Content-Type: text/event-stream` and write SSE chunks:
  `data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n`,
  `data: {"choices":[{"delta":{"content":"DATETIME-OK 2026-07-24"}}]}\n\n`,
  `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":3,"total_tokens":4}}\n\n`,
  `data: [DONE]\n\n`, then `end()`. On listen, print
  `http://127.0.0.1:${port}/v1` to stdout (the base URL the register uses).
- **architecture.test.ts**: `test ai-provider` adds 1 leaf file
  (`commands/test/ai-provider.ts`) + 1 registered leaf → bump both counters by 1
  from their current post-008.x values (state the exact numbers after confirming
  the running total).

## Constraints

- One-shot only — no agent tools, no workspace, no landing. The call is a plain
  completion.
- The CLI prints the model's raw text; it does not interpret or validate the
  answer (the Proof greps for the mock's `DATETIME-OK` marker).

## Verify

- New `src/app/ai-provider/test-ai-provider.test.ts` (fake `sessions` whose
  `streamFn` emits scripted `text_delta` events): `execute` returns the
  concatenated text; unknown id → `UnknownReferenceError`.
- New `src/apps/cli/ai-provider.test.ts` case: `test ai-provider --id X` prints
  the collected text on stdout.
- `npm run verify` exits 0 (counters updated).
- Proof (008.1-custom Proof): delivers **PASS C/D** — `test ai-provider` reaches
  the custom model (via the mock) and prints the `DATETIME-OK` response.
