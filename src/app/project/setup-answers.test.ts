// src/app/project/setup-answers.test.ts — EPIC 015 Story 2
// Hermetic, pure tests for `parseSetupAnswers`. The parser is the gatekeeper:
// it must accept every well-formed answer set, reject every malformed one
// without ever echoing a secret, and never partially build `answers` when
// validation fails. Tests in this file are the executable contract; the Proof
// script's Phases A–D are the cross-check.
//
// Why a function and not a class: the parse is a single text → value
// transformation with no dependencies, and the only seam we depend on is
// `baseDir` (data, not a port). The function shape keeps the tests
// hermetic and the test file readable.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseSetupAnswers } from "./setup-answers.ts";
import type { SetupAnswers } from "./setup-plan.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The exact, valid answer set written by `scripts/e2e/guided-setup-proof.sh`
 * with `#` comment and blank line at the top. The `baseDir` defaults to `/`
 * so all paths here are absolute — relative resolution is tested separately. */
function fullHttpsTokenAnswers(
  overrides: {
    baseDir?: string;
    remoteUrl?: string;
    path?: string;
    valueFile?: string;
    packagePath?: string;
  } = {},
): string {
  const baseDir = overrides.baseDir ?? "/";
  const remoteUrl = overrides.remoteUrl ?? "file:///srv/home.git";
  const path = overrides.path ?? "/srv/mirror";
  const valueFile = overrides.valueFile ?? "/srv/token";
  const packagePath = overrides.packagePath ?? "/srv/g";
  return `# comments and blank lines are ignored

project.name=demo
repository.name=home
repository.remoteUrl=${remoteUrl}
repository.branch=main
repository.path=${path}
repository.auth=https-token
credential.name=gh
credential.provider=github
credential.valueFile=${valueFile}
provider.route=apiKey
provider.name=e2e
provider.provider=openai-codex
provider.model=gpt-5.6-sol
provider.valueFile=${valueFile}
provider.confirmCost=true
graph.packagePath=${packagePath}
graph.bind.source=home
`;
}

function assertOk(
  result: ReturnType<typeof parseSetupAnswers>,
): asserts result is { ok: true; answers: SetupAnswers } {
  assert.equal(result.ok, true, "expected ok: true");
}

// ── Happy path ───────────────────────────────────────────────────────────────

describe("parseSetupAnswers — happy path", () => {
  test("the exact Proof answer set parses to ok:true with the right discriminants", () => {
    const result = parseSetupAnswers(fullHttpsTokenAnswers(), "/");

    assertOk(result);
    assert.equal(result.answers.project.name, "demo");
    assert.equal(result.answers.repository.auth, "https-token");
    assert.equal(result.answers.provider.route, "apiKey");
    assert.equal(
      (
        result.answers.provider as Extract<
          SetupAnswers["provider"],
          { route: "apiKey" }
        >
      ).confirmCost,
      true,
    );
    assert.equal(result.answers.graph.skip, false);
    assert.deepEqual(
      (result.answers.graph as Extract<SetupAnswers["graph"], { skip: false }>)
        .bind,
      { source: "home" },
    );
  });
});

// ── Grammar ──────────────────────────────────────────────────────────────────

describe("parseSetupAnswers — grammar", () => {
  test("# comment line is ignored", () => {
    const result = parseSetupAnswers(
      "# a comment\nproject.name=demo\nrepository.name=home\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
  });

  test("blank line is ignored", () => {
    const result = parseSetupAnswers(
      [
        "",
        "",
        "project.name=demo",
        "",
        "repository.name=home",
        "repository.remoteUrl=u",
        "repository.branch=main",
        "repository.path=/p",
        "repository.auth=ambient",
        "provider.route=oauth",
        "provider.name=p",
        "provider.provider=openai-codex",
        "provider.model=m",
        "provider.oauthMethod=browser",
        "graph.skip=true",
        "",
      ].join("\n"),
      "/",
    );
    assertOk(result);
  });

  test("value containing = keeps everything after the first =", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=https://x/y?a=1&b=2\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(
      result.answers.repository.remoteUrl,
      "https://x/y?a=1&b=2",
      "value after the first = is preserved verbatim",
    );
  });

  test("value containing # keeps the # (no inline-comment stripping)", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home#not-a-comment\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(
      result.answers.repository.name,
      "home#not-a-comment",
      "the # must remain part of the value",
    );
  });

  test("value containing $HOME is NOT expanded", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=$HOME/mirror\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(
      result.answers.repository.path,
      "/$HOME/mirror",
      "no shell expansion — $HOME is a literal value; the leading '/' comes " +
        "from resolving the relative value against baseDir '/' (Story 2's " +
        "'repository.path is always absolute' constraint applies even when " +
        "baseDir is the filesystem root)",
    );
  });

  test("line without = errors naming its line number", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nthis-is-not-a-key-value\nrepository.name=home\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /line 2/);
    assert.match(result.errors.join("\n"), /key=value/);
  });

  test("empty value errors naming the key", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /provider\.name/);
  });

  test("duplicate key errors naming the key", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nproject.name=demo2\nrepository.name=home\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /duplicate key: project\.name/);
  });

  test("same graph.bind.<alias> twice errors as duplicate", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=false\ngraph.packagePath=/g\ngraph.bind.source=home\ngraph.bind.source=other\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(
      result.errors.join("\n"),
      /duplicate key: graph\.bind\.source/,
    );
  });

  test("graph.bind.a and graph.bind.b both parse as distinct keys", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=u\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=false\ngraph.packagePath=/g\ngraph.bind.a=home\ngraph.bind.b=other\n",
      "/",
    );
    assertOk(result);
    assert.deepEqual(
      (result.answers.graph as Extract<SetupAnswers["graph"], { skip: false }>)
        .bind,
      { a: "home", b: "other" },
    );
  });
});

// ── Missing keys ─────────────────────────────────────────────────────────────

describe("parseSetupAnswers — missing required keys", () => {
  test("with only project.name + repository.name + repository.remoteUrl the error names repository.*", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///x\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /repository\.(branch|path|auth)/);
  });
});

// ── Unknown / irrelevant keys ────────────────────────────────────────────────

describe("parseSetupAnswers — unknown key", () => {
  test("repository.colour=blue errors naming the key", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "repository.colour=blue\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unknown key: repository\.colour/);
  });
});

describe("parseSetupAnswers — irrelevant keys", () => {
  test("provider.oauthMethod under provider.route=apiKey errors", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "provider.oauthMethod=browser\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /provider\.oauthMethod/);
  });

  test("provider.baseUrl under provider.route=apiKey errors", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "provider.baseUrl=https://api.example.com\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /provider\.baseUrl/);
  });

  test("credential.* under repository.auth=ambient errors", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers().replace(
        "repository.auth=https-token",
        "repository.auth=ambient",
      ) +
        "credential.name=gh\ncredential.provider=github\ncredential.valueFile=/t\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /credential\./);
  });

  test("graph.packagePath under graph.skip=true errors", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "graph.skip=true\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /graph\.packagePath/);
  });
});

// ── Secret rules ─────────────────────────────────────────────────────────────

describe("parseSetupAnswers — secret rules", () => {
  test("credential.value=... yields a secret-SPECIFIC error (valueFile, no 'unknown key', no echo)", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "credential.value=super-secret-value\n",
      "/",
    );
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(
      joined,
      /valueFile/i,
      "must mention valueFile as the correct shape",
    );
    assert.doesNotMatch(
      joined,
      /unknown key/i,
      "secret keys must not be rejected as unknown",
    );
    assert.doesNotMatch(
      joined,
      /super-secret-value/,
      "the secret value must never appear in the error",
    );
  });

  test("provider.value=... yields the same secret-specific treatment", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "provider.value=super-secret-value\n",
      "/",
    );
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /valueFile/i);
    assert.doesNotMatch(joined, /unknown key/i);
    assert.doesNotMatch(joined, /super-secret-value/);
  });

  test("credential.valueFile=- errors mentioning stdin", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers().replace(
        /credential\.valueFile=.*/,
        "credential.valueFile=-",
      ),
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /stdin/);
  });

  test("provider.valueFile=- errors mentioning stdin", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers().replace(
        /provider\.valueFile=.*/,
        "provider.valueFile=-",
      ),
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /stdin/);
  });
});

// ── Embedded credential ──────────────────────────────────────────────────────

describe("parseSetupAnswers — embedded credential", () => {
  test("repository.remoteUrl with userinfo errors 'embedded credential' without echoing the token", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers({
        remoteUrl: "https://user:tok3n-should-not-appear@example.com/r.git",
      }),
      "/",
    );
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /embedded credential/i);
    assert.doesNotMatch(joined, /tok3n-should-not-appear/);
    assert.doesNotMatch(joined, /user:/);
  });
});

// ── Booleans ─────────────────────────────────────────────────────────────────

describe("parseSetupAnswers — booleans", () => {
  test("graph.skip=TRUE errors naming the key", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "graph.skip=TRUE\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /graph\.skip/);
  });

  test("graph.skip=1 errors naming the key", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "graph.skip=1\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /graph\.skip/);
  });

  test("provider.confirmCost=yes errors naming the key", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers() + "provider.confirmCost=yes\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /provider\.confirmCost/);
  });

  test("provider.confirmCost=false under route apiKey errors (must be true to authorise verification)", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers().replace(
        "provider.confirmCost=true",
        "provider.confirmCost=false",
      ),
      "/",
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /provider\.confirmCost/);
  });
});

// ── Enums ────────────────────────────────────────────────────────────────────

describe("parseSetupAnswers — enum value domains", () => {
  test("bad repository.auth lists the allowed values", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers().replace(
        "repository.auth=https-token",
        "repository.auth=password",
      ),
      "/",
    );
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /repository\.auth/);
    assert.match(joined, /ambient/);
    assert.match(joined, /https-token/);
    assert.match(joined, /ssh-agent/);
  });

  test("bad provider.route lists the allowed values", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers().replace(
        "provider.route=apiKey",
        "provider.route=graphql",
      ),
      "/",
    );
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /provider\.route/);
    assert.match(joined, /oauth/);
    assert.match(joined, /apiKey/);
    assert.match(joined, /custom/);
  });

  test("bad provider.api lists the allowed values", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers()
        .replace("provider.route=apiKey", "provider.route=custom")
        .replace(
          "provider.valueFile=/srv/token",
          "provider.valueFile=/srv/token\nprovider.baseUrl=https://x\nprovider.api=openai-bad",
        ),
      "/",
    );
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /provider\.api/);
    assert.match(joined, /openai-completions/);
    assert.match(joined, /openai-responses/);
  });
});

// ── Route / auth completeness ────────────────────────────────────────────────

describe("parseSetupAnswers — route completeness", () => {
  test("valid oauth set (provider.oauthMethod, no valueFile/confirmCost) parses", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///x\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(result.answers.provider.route, "oauth");
  });

  test("valid custom set (with baseUrl + api) parses", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///x\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=custom\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.valueFile=/srv/token\nprovider.confirmCost=true\nprovider.baseUrl=https://api.example.com\nprovider.api=openai-completions\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(result.answers.provider.route, "custom");
  });
});

describe("parseSetupAnswers — auth completeness", () => {
  test("valid ambient set without any credential.* key parses, credential === undefined", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///x\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ambient\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(result.answers.credential, undefined);
  });

  test("valid ssh-agent set without any credential.* key parses, credential === undefined", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///x\nrepository.branch=main\nrepository.path=/p\nrepository.auth=ssh-agent\nprovider.route=oauth\nprovider.name=p\nprovider.provider=openai-codex\nprovider.model=m\nprovider.oauthMethod=browser\ngraph.skip=true\n",
      "/",
    );
    assertOk(result);
    assert.equal(result.answers.credential, undefined);
  });
});

// ── Path resolution ──────────────────────────────────────────────────────────

describe("parseSetupAnswers — path resolution", () => {
  test("relative repository.path is resolved against baseDir", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers({ path: "./mirror" }),
      "/tmp/x",
    );
    assertOk(result);
    assert.equal(result.answers.repository.path, "/tmp/x/mirror");
  });

  test("absolute repository.path is unchanged", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers({ path: "/abs/mirror" }),
      "/tmp/x",
    );
    assertOk(result);
    assert.equal(result.answers.repository.path, "/abs/mirror");
  });

  test("relative credential.valueFile is resolved against baseDir", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers({ valueFile: "./token" }),
      "/tmp/x",
    );
    assertOk(result);
    assert.equal(
      (result.answers.credential as Extract<SetupAnswers["credential"], {}>)
        .valueFile,
      "/tmp/x/token",
    );
  });

  test("relative provider.valueFile is resolved against baseDir", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers({ valueFile: "./token" }),
      "/tmp/x",
    );
    assertOk(result);
    assert.equal(
      (
        result.answers.provider as Extract<
          SetupAnswers["provider"],
          { route: "apiKey" }
        >
      ).valueFile,
      "/tmp/x/token",
    );
  });

  test("relative graph.packagePath is resolved against baseDir", () => {
    const result = parseSetupAnswers(
      fullHttpsTokenAnswers({ packagePath: "./g" }),
      "/tmp/x",
    );
    assertOk(result);
    assert.equal(
      (result.answers.graph as Extract<SetupAnswers["graph"], { skip: false }>)
        .packagePath,
      "/tmp/x/g",
    );
  });
});

// ── Atomicity ────────────────────────────────────────────────────────────────

describe("parseSetupAnswers — atomicity", () => {
  test("a set missing one required key returns ok:false and has no `answers` property", () => {
    const result = parseSetupAnswers(
      "project.name=demo\nrepository.name=home\nrepository.remoteUrl=file:///x\n",
      "/",
    );
    assert.equal(result.ok, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "answers"),
      false,
      "a failed parse must not expose a partial `answers` value",
    );
  });
});

// ── Multiple simultaneous violations ─────────────────────────────────────────

describe("parseSetupAnswers — multiple errors collected", () => {
  test("an unknown key AND a missing key both appear in the same errors array", () => {
    // Unknown key (repository.colour) + missing required (repository.branch
    // not present). Both must surface in one parse — atomicity does not
    // collapse to "first error only".
    const text =
      [
        "project.name=demo",
        "repository.name=home",
        "repository.remoteUrl=file:///x",
        "repository.path=/p",
        "repository.auth=ambient",
        "repository.colour=blue",
        "provider.route=oauth",
        "provider.name=p",
        "provider.provider=openai-codex",
        "provider.model=m",
        "provider.oauthMethod=browser",
        "graph.skip=true",
      ].join("\n") + "\n";
    const result = parseSetupAnswers(text, "/");
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes("unknown key: repository.colour")),
      "the unknown-key error must be present",
    );
    assert.ok(
      result.errors.some((e) => /repository\.branch/.test(e)),
      "the missing-key error for repository.branch must be present",
    );
    assert.equal(
      result.errors.length,
      2,
      "exactly the unknown-key and missing-key violations, nothing more",
    );
  });
});
