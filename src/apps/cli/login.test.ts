/**
 * `login <provider>` CLI handler (thin) — after S4 the OAuth orchestration
 * lives in the LoginProvider use case; this handler only parses/validates
 * inputs, builds the terminal presenter, calls the use case, and formats.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runLogin, type LoginDeps } from "./login.ts";
import type {
  LoginProvider,
  LoginProviderInput,
} from "../../app/auth/login-provider.ts";

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZPA";

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
  impl?: (input: LoginProviderInput) => Promise<string>,
): { calls: LoginProviderInput[]; provider: LoginProvider } {
  const calls: LoginProviderInput[] = [];
  const provider = {
    async execute(input: LoginProviderInput) {
      calls.push(input);
      return impl ? impl(input) : "01HCREDENTIALID0000000000";
    },
  } as unknown as LoginProvider;
  return { calls, provider };
}

function deps(loginProvider: LoginProvider, io: LoginDeps["io"]): LoginDeps {
  return { loginProvider, io };
}

describe("runLogin (thin handler)", () => {
  test("happy path: calls the use case with parsed inputs, returns the credential id", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();

    const result = await runLogin(
      "openai-codex",
      { project: PROJECT_ID, name: "openai", method: "browser" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, ["01HCREDENTIALID0000000000"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.providerId, "openai-codex");
    assert.equal(calls[0]?.projectId, PROJECT_ID);
    assert.equal(calls[0]?.name, "openai");
    assert.equal(calls[0]?.method, "browser");
  });

  test("method defaults to browser when --method omitted", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();
    await runLogin(
      "anthropic",
      { project: PROJECT_ID, name: "c" },
      deps(provider, io),
    );
    assert.equal(calls[0]?.method, "browser");
  });

  test("presenter.showAuthUrl prints the auth URL live so the human can open it (B1)", async () => {
    const { printed, io } = fakeIO();
    const { provider } = fakeLoginProvider(async (input) => {
      // Simulate the adapter surfacing the auth URL through the presenter.
      input.presenter.showAuthUrl("https://auth.example/authorize?x=1");
      return "cid";
    });

    const result = await runLogin(
      "openai-codex",
      { project: PROJECT_ID, name: "openai" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 0);
    assert.ok(
      printed.some((line) =>
        line.includes("https://auth.example/authorize?x=1"),
      ),
      "the auth URL is printed live",
    );
  });

  test("use-case error is mapped to exit 1 + one clean line, no crash (B2)", async () => {
    const { io } = fakeIO();
    const { provider } = fakeLoginProvider(async () => {
      throw new Error("Login cancelled");
    });

    const result = await runLogin(
      "openai-codex",
      { project: PROJECT_ID, name: "openai" },
      deps(provider, io),
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(result.stderr, ["error: Login cancelled"]);
  });

  test("missing --project: fails before the use case runs (B5)", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();
    const result = await runLogin(
      "anthropic",
      { name: "c" },
      deps(provider, io),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0, "use case must not run without --project");
    assert.equal(result.stderr.length, 1);
  });

  test("missing provider argument: exit 1, use case not called", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();
    const result = await runLogin(
      "",
      { project: PROJECT_ID, name: "c" },
      deps(provider, io),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
  });

  test("invalid --method: exit 1, use case not called", async () => {
    const { calls, provider } = fakeLoginProvider();
    const { io } = fakeIO();
    const result = await runLogin(
      "openai-codex",
      { project: PROJECT_ID, name: "c", method: "carrier-pigeon" },
      deps(provider, io),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.stderr[0] ?? "", /method/);
  });
});
