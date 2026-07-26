/**
 * LoginProvider use case — authenticate via OAuth, then persist as a global
 * ai-provider via registerGlobalProvider. Hermetic: fakes for oauth, registry,
 * modelCatalog, and listModels (008.3 Story E).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LoginProvider } from "./login-provider.ts";
import type {
  OAuthLoginProvider,
  OAuthLoginPresenter,
} from "../../oauth/port.ts";
import type { AiProviderRegistry, UnitOfWork } from "../../storage/port.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError } from "../errors.ts";

const PRESENTER: OAuthLoginPresenter = {
  showAuthUrl: () => {},
  showDeviceCode: () => {},
  progress: () => {},
  promptCode: async () => "",
};

// ── fakes ──

function fakeOAuth(hasResult: boolean): {
  oauth: OAuthLoginProvider;
  calls: number;
} {
  let calls = 0;
  return {
    oauth: {
      has: () => hasResult,
      async login() {
        calls++;
        return '{"type":"oauth","access":"t"}';
      },
    } as OAuthLoginProvider,
    get calls() {
      return calls;
    },
  };
}

const UNIT_OF_WORK: UnitOfWork = {
  transaction: <T>(fn: () => T) => fn(),
};

function fakeCatalog(isValid: boolean): ModelCatalog {
  return {
    isValid: () => isValid,
    hasProvider: () => true,
    getEfforts: () => [],
  } as unknown as ModelCatalog;
}

function trackRegistry(): {
  registry: AiProviderRegistry;
  registerInputs: Array<Record<string, unknown>>;
} {
  const registerInputs: Array<Record<string, unknown>> = [];
  let idx = 0;
  return {
    registerInputs,
    registry: {
      register(input: Record<string, unknown>) {
        const id = `prov-${++idx}`;
        registerInputs.push({ ...input });
        return {
          id,
          name: input.name,
          provider: input.provider,
          model: input.model,
          baseUrl: (input.baseUrl as string) ?? null,
          effort: (input.effort as string) ?? null,
          value: input.value,
          state: "active",
          credentialVersion: 1,
          api: null,
          contextWindow: null,
          maxTokens: null,
        };
      },
      list: () => [],
      get: () => undefined,
      getDefault: () => undefined,
      setDefault: () => {},
      clearDefault: () => {},
      logout: () => {},
      remove: () => {},
      updateCredentialCAS: () => ({ applied: false as const }),
      assign: () => {},
      unassign: () => {},
      listAssigned: () => [],
      maxRank: () => undefined,
      shiftRanksFrom: () => {},
      compactRanks: () => {},
      getAssignment: () => undefined,
      listProjectsAssigning: () => [],
    } as AiProviderRegistry,
  };
}

// ── tests ──

describe("LoginProvider (global registry — Story E)", () => {
  test("(Story E) happy path: OAuth succeeds → registerGlobalProvider → returns provider id", async () => {
    const { oauth } = fakeOAuth(true);
    const { registry, registerInputs } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(true),
      listModels: () => [],
    });

    const id = await uc.execute({
      providerId: "openai-codex",
      name: "my-acct",
      method: "browser",
      presenter: PRESENTER,
      model: "gpt-5.6-sol",
    });

    assert.equal(
      id,
      "prov-1",
      "returned id must come from registry.register, not injected newId",
    );
    assert.equal(registerInputs.length, 1);
    const args = registerInputs[0]!;
    assert.equal(args.name, "my-acct");
    assert.equal(args.provider, "openai-codex");
    assert.equal(args.model, "gpt-5.6-sol");
    assert.equal(args.value, '{"type":"oauth","access":"t"}');
  });

  test("(Story E) OAuth-only guard: rejects non-OAuth provider with NonOAuthProviderError", async () => {
    const { oauth } = fakeOAuth(false); // has() returns false
    const { registry, registerInputs } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(true),
      listModels: () => [],
    });

    await assert.rejects(
      uc.execute({
        providerId: "opencode",
        name: "acct",
        method: "browser",
        presenter: PRESENTER,
        selectModel: async () => "some-model",
      }),
      (err: Error) =>
        err.name === "NonOAuthProviderError" &&
        err.message.includes("register"),
    );

    assert.equal(
      registerInputs.length,
      0,
      "registerGlobalProvider must not be called after guard reject",
    );
  });

  test("(Story E) --model given: selectModel not called, model passed directly", async () => {
    let selectModelCalled = false;
    const { oauth } = fakeOAuth(true);
    const { registry, registerInputs } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(true),
      listModels: () => ["m1", "m2", "m3"],
    });

    await uc.execute({
      providerId: "openai-codex",
      name: "acct",
      method: "browser",
      presenter: PRESENTER,
      model: "m2",
      selectModel: async () => {
        selectModelCalled = true;
        return "m1";
      },
    });

    assert.equal(
      selectModelCalled,
      false,
      "selectModel must NOT be called when --model is given",
    );
    assert.equal(
      registerInputs[0]!.model,
      "m2",
      "the explicit --model must be used",
    );
  });

  test("(Story E) --model absent: selectModel invoked with listModels output", async () => {
    const { oauth } = fakeOAuth(true);
    const { registry, registerInputs } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(true),
      listModels: (p: string) =>
        p === "openai-codex" ? ["m1", "m2", "m3"] : [],
    });

    await uc.execute({
      providerId: "openai-codex",
      name: "acct",
      method: "browser",
      presenter: PRESENTER,
      selectModel: async (choices: string[]) => {
        assert.deepEqual(choices, ["m1", "m2", "m3"]);
        return "m3";
      },
    });

    assert.equal(
      registerInputs[0]!.model,
      "m3",
      "selected model from selectModel must be used",
    );
  });

  test("(Story E) unknown --model: modelCatalog.isValid rejects → UnknownModelError", async () => {
    const { oauth } = fakeOAuth(true);
    const { registry, registerInputs } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(false), // isValid returns false
      listModels: () => [],
    });

    await assert.rejects(
      uc.execute({
        providerId: "openai-codex",
        name: "acct",
        method: "browser",
        presenter: PRESENTER,
        model: "no-such-model",
      }),
      UnknownModelError,
    );

    assert.equal(
      registerInputs.length,
      0,
      "register must not be called when model is invalid",
    );
  });

  test("(Story E) baseUrl/effort passthrough to registerGlobalProvider", async () => {
    const { oauth } = fakeOAuth(true);
    const { registry, registerInputs } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(true),
      listModels: () => [],
    });

    await uc.execute({
      providerId: "openai-codex",
      name: "acct",
      method: "browser",
      presenter: PRESENTER,
      model: "gpt-5.6",
      baseUrl: "https://custom.example/api",
      effort: "low",
    });

    assert.equal(registerInputs[0]!.baseUrl, "https://custom.example/api");
    assert.equal(registerInputs[0]!.effort, "low");
  });

  // ── BLOCKER 6 — guard before OAuth when no model/selectModel ──

  test("(BLOCKER 6) LoginProvider: guard rejects before OAuth when no model and no selectModel", async () => {
    let oauthCalled = false;
    const oauth: OAuthLoginProvider = {
      has: () => true,
      async login() {
        oauthCalled = true;
        return '{"type":"oauth","access":"t"}';
      },
    };
    const { registry } = trackRegistry();
    const uc = new LoginProvider({
      oauth,
      registry,
      unitOfWork: UNIT_OF_WORK,
      modelCatalog: fakeCatalog(true),
      listModels: () => ["m1", "m2"],
    });

    // No model AND no selectModel — should reject before touching OAuth
    await assert.rejects(
      uc.execute({
        providerId: "openai-codex",
        name: "acct",
        method: "browser",
        presenter: PRESENTER,
        // no model, no selectModel
      }),
      (err: Error) => {
        return err.message.includes("model") || err.name === "Error";
      },
      "must reject with a descriptive error when no model selection mechanism exists",
    );

    assert.equal(
      oauthCalled,
      false,
      "OAuth.login must NOT be called; guard rejected first",
    );
  });
});
