/**
 * `login <provider>` CLI handler (thin) — after 008.3 Story E the login
 * creates a global ai-provider (not a project-scoped credential).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runLogin, type LoginDeps } from "./login.ts";
import type { LoginProvider } from "../../app/auth/login-provider.ts";

function fakeIO() {
  const printed: string[] = [];
  return {
    printed,
    io: {
      print: (m: string) => printed.push(m),
      prompt: async () => "",
    },
  };
}

/** A fake LoginProvider use case that records the input and returns a fixed id. */
function fakeLoginProvider(
  impl?: (input: Record<string, unknown>) => Promise<string>,
): { calls: Record<string, unknown>[]; provider: LoginProvider } {
  const calls: Record<string, unknown>[] = [];
  const provider = {
    async execute(input: Record<string, unknown>) {
      calls.push(input);
      return impl ? impl(input) : "01HPROVIDER000000000000000";
    },
  } as unknown as LoginProvider;
  return { calls, provider };
}

function deps(loginProvider: LoginProvider, io: LoginDeps["io"]): LoginDeps {
  return { loginProvider, io };
}

describe("runLogin (Story E — global registry)", () => {
  test("(Story E) happy path: no --project, success confirms as ai-provider registered", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    const result = await runLogin(
      "openai-codex",
      { name: "my-acct", method: "browser" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["01HPROVIDER000000000000000"]);
    assert.deepEqual(
      result.stderr,
      ["ai-provider registered: 01HPROVIDER000000000000000"],
      "(Story E) login must confirm the registered ai-provider, not a credential",
    );
    assert.equal(calls.length, 1);
    const input = calls[0]!;
    assert.equal(input.providerId, "openai-codex");
    assert.equal(input.name, "my-acct");
    assert.equal(input.method, "browser");
  });

  test("(Story E) method defaults to browser when --method omitted", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    await runLogin("anthropic", { name: "c" }, deps(provider, io));

    const input = calls[0]!;
    assert.equal(input.method, "browser");
  });

  test("(Story E) presenter.showAuthUrl prints the auth URL live", async () => {
    const { printed, io } = fakeIO();
    const { provider } = fakeLoginProvider(async (input) => {
      (input as any).presenter?.showAuthUrl?.(
        "https://auth.example/authorize?x=1",
      );
      return "cid";
    });

    const result = await runLogin(
      "openai-codex",
      { name: "my-acct" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 0);
    assert.ok(
      printed.some((l) => l.includes("https://auth.example/authorize?x=1")),
      "auth URL must be printed live",
    );
  });

  test("(Story E) use-case error maps to exit 1 + one clean line, no crash", async () => {
    const { io } = fakeIO();
    const { provider } = fakeLoginProvider(async () => {
      throw new Error("Login cancelled");
    });

    const result = await runLogin(
      "openai-codex",
      { name: "my-acct" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(result.stderr, ["error: Login cancelled"]);
  });

  test("(Story E) NonOAuthProviderError maps to exit 1 with register hint", async () => {
    const { io } = fakeIO();
    const { provider } = fakeLoginProvider(async () => {
      const err = new Error(
        "use `register ai-provider --value-file` for API-key providers",
      );
      err.name = "NonOAuthProviderError";
      throw err;
    });

    const result = await runLogin(
      "opencode",
      { name: "acct" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]?.includes("register ai-provider"),
      "error must hint at register ai-provider",
    );
  });

  test("(Story E) missing --name: fails before the use case runs", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    const result = await runLogin("anthropic", {}, deps(provider, io));

    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0, "use case must not run without --name");
    assert.equal(result.stderr.length, 1);
    assert.ok(result.stderr[0]?.includes("name"), "error must mention --name");
  });

  test("missing provider argument: exit 1, use case not called", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    const result = await runLogin("", { name: "c" }, deps(provider, io));

    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
  });

  test("invalid --method: exit 1, use case not called", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    const result = await runLogin(
      "openai-codex",
      { name: "c", method: "carrier-pigeon" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.stderr[0] ?? "", /method/);
  });

  test("(Story E) --model given: passed through to use case input", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    await runLogin(
      "openai-codex",
      { name: "acct", method: "browser", model: "gpt-5.6-sol" },
      deps(provider, io),
    );

    assert.equal(calls.length, 1);
    const input = calls[0]!;
    assert.equal(input.model, "gpt-5.6-sol");
  });

  // ── BLOCKER 6 — CLI must supply selectModel, baseUrl, effort ──

  test("(BLOCKER 6) runLogin supplies selectModel callback when --model absent", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    await runLogin(
      "openai-codex",
      { name: "acct", method: "browser" },
      deps(provider, io),
    );

    assert.equal(calls.length, 1, "loginProvider.execute must be called");
    const input = calls[0]!;
    assert.ok(
      typeof input.selectModel === "function",
      "selectModel callback must be supplied when --model is absent; current login.ts drops it",
    );
  });

  test("(BLOCKER 6) runLogin forwards baseUrl and effort to use case", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    await runLogin(
      "anthropic",
      {
        name: "acct",
        method: "browser",
        baseUrl: "https://custom.api/v1",
        effort: "high",
      },
      deps(provider, io),
    );

    assert.equal(calls.length, 1);
    const input = calls[0]!;
    assert.equal(
      input.baseUrl,
      "https://custom.api/v1",
      "baseUrl must be forwarded",
    );
    assert.equal(input.effort, "high", "effort must be forwarded");
  });

  // ── BLOCKER S4 — numbered model list + validated pick ──

  test("(BLOCKER S4) runLogin's selectModel prints a NUMBERED model list before prompting", async () => {
    const { printed, io } = fakeIO();
    const { provider } = fakeLoginProvider(async (input) => {
      const picked = await (
        input.selectModel as (models: string[]) => Promise<string>
      )(["gpt-alpha", "gpt-beta"]);
      return picked;
    });

    await runLogin(
      "openai-codex",
      { name: "acct", method: "browser" },
      deps(provider, io),
    );

    const combined = printed.join("\n");
    assert.match(
      combined,
      /1\.\s*gpt-alpha/,
      "must print a numbered entry for the first model",
    );
    assert.match(
      combined,
      /2\.\s*gpt-beta/,
      "must print a numbered entry for the second model",
    );
  });

  test("(BLOCKER S4) runLogin's selectModel rejects a pick that is not in the given model list", async () => {
    const { io } = fakeIO();
    io.prompt = async () => "not-a-real-model";
    const { provider } = fakeLoginProvider(async (input) => {
      return (input.selectModel as (models: string[]) => Promise<string>)([
        "gpt-alpha",
        "gpt-beta",
      ]);
    });

    const result = await runLogin(
      "openai-codex",
      { name: "acct", method: "browser" },
      deps(provider, io),
    );

    assert.equal(
      result.exitCode,
      1,
      "an out-of-list pick must fail, not silently pass through",
    );
  });
});
