# EPIC 008.1 (custom) — Custom OpenAI-compatible provider + test CLI — stories

Epic: `.agent/plan/epics/008.1-custom-openai-compatible-provider.md`
Prereq (by capability): `008.1-global-ai-provider-registry` (the `ai_providers`
table, `AiProviderRegistry`, `register ai-provider`, `src/apps/cli/ai-provider.ts`,
the `GlobalAiProvider` shape) **and** `008.3-daemon-auto-resolve-provider` (the
resolved-provider → `sessions.for` path). Shares the `008.1` number by decision;
depends on those two epics' capabilities, not on number order.

Register a custom OpenAI-compatible provider (custom `--base-url` + allowlisted
`--api` + `--model` + api-key) into the global registry; the session factory
reconstructs it via pi `createProvider`+`setProvider` under a session-local
runtime id; `test ai-provider --id` asks the model a prompt and prints the reply.

## Dispatch order

1. **01** — custom-provider schema (migration 20) + registry fields.
2. **02** — `register ai-provider` custom path.
3. **03** — session reconstruction for custom providers.
4. **04** — `test ai-provider` CLI + openai-completions mock fixture.
5. **05** — endpoint trust controls.

02 and 05 both edit the register handler — do 02 then 05.

## Stories

- A — custom-provider schema → `01-custom-schema.md`
- B — register custom path → `02-register-custom.md`
- C — session reconstruction → `03-session-reconstruction.md`
- D — `test ai-provider` CLI + mock → `04-test-cli-and-mock.md`
- E — endpoint trust controls → `05-endpoint-trust.md`

## Facts (needed for implementation)

- **pi provider construction** (importable from the main `@earendil-works/pi-ai`
  entry, `dist/index.d.ts:19` re-exports `./models`): `createModels(opts?):
MutableModels` (`models.d.ts:94`), `MutableModels.setProvider(provider)`
  (`:84-89`), `createProvider(CreateProviderOptions)` (`:95-122`). A custom
  provider is `createProvider({ id, name, baseUrl, auth:{apiKey}, models:
Model[], api })`. `openAICompletionsApi()` from
  `"@earendil-works/pi-ai/api/openai-completions.lazy"`; `openAIResponsesApi()`
  from the matching subpath. Reference: `pi/packages/ai/src/providers/qwen-token-plan.ts`.
- **`Model<TApi>` required fields** (`pi types.ts:749-776`): `id, name, api,
provider, baseUrl, reasoning:boolean, input:("text"|"image")[], cost:ModelCost
({input,output,cacheRead,cacheWrite}), contextWindow:number, maxTokens:number`;
  optional `compat`/`headers`/`thinkingLevelMap`. Models can be supplied **inline**
  — no JSON/codegen (the qwen JSON is generated + absent from the tree).
- **Session factory injection point** — `src/agent-runner/pi-session.ts:200-218`:
  today `builtinModels(...)` → `getModel(provider, model)` → baseUrl-clone →
  `withReasoning`. For a custom record, replace with `const models =
createModels(...); models.setProvider(createProvider({ id: runtimeId, … }));
const found = models.getModel(runtimeId, model);`. `ProviderSession`
  (`:29-34`) = `{ model, streamFn, getApiKey, credentialStore? }`; `streamFn =
withReasoning(models.streamSimple.bind(models), effort)`; API-key `getApiKey =
() => credential.value` (`:196-197`).
- **One-shot completion** (test CLI): `session.streamFn(session.model, {
messages: [{ role:"user", content:[{type:"text", text: prompt}] }] })` returns
  an event stream; accumulate `text_delta.delta` events and/or read the terminal
  `done` event's `message.content` `TextContent` blocks. `Context` =
  `{systemPrompt?, messages, tools?}` (`pi types.d.ts:323`). No Agent loop, no
  workspace. (`Models.completeSimple` exists but `ProviderSession` doesn't expose
  it — use `streamFn`.)
- **Mock wire format**: pi uses the official `openai` SDK
  (`openai-completions.ts:663-668`, `baseURL=model.baseUrl`, path
  `/chat/completions` SDK-appended, `stream:true`, `stream_options.include_usage`).
  Mock serves `POST {baseUrl}/chat/completions`, `Content-Type: text/event-stream`,
  streaming `data: {"choices":[{"delta":{"content":"…"}}]}` chunks, a final
  `{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{…}}`, then
  `data: [DONE]`. Text is read from `choice.delta.content` (`:437-481`).
- **Register surface** — `src/apps/cli/ai-provider.ts` / `runRegisterAiProvider`
  is created by the `008.1-global-ai-provider-registry` stories (Story 03). This
  epic **extends** it. Nearest existing pattern: `runCreateAiProvider`
  (`src/apps/cli/resource.ts:208-247`). Embedded-cred guard: `hasEmbeddedUserinfo`
  (`src/domain/resource.ts:118-129`).
- **Migration**: global sequential order — after 16/17/18/19 (the other 008.x),
  this epic's schema is **migration 20**. (The epic number is 008.1 by decision;
  the migration number is independent and must be the next free integer.)
- CLI/test conventions: see the `008.1-global-ai-provider-registry` index Facts.
