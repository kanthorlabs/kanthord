// src/app/project/setup-plan.test.ts — EPIC 015 Story 1
// Hermetic, pure tests for the SetupPlan (the reconciliation engine).
// Zero I/O, zero fakes — every observation is constructed inline and
// handed to the pure plan.
//
// The plan is the orchestrator's oracle: every later step decides
// (create / skip / drift / ambiguous) by reading its output, so a
// regression here is a regression in every Phase of the Proof.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  planGraph,
  planSetup,
  type ObservedFacts,
  type SetupAnswers,
} from "./setup-plan.ts";

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal "happy path" set of answers for the most common test inputs. */
function answers(overrides: Partial<SetupAnswers> = {}): SetupAnswers {
  return {
    project: { name: "demo" },
    repository: {
      name: "repo",
      remoteUrl: "https://git.example.com/owner/repo.git",
      branch: "main",
      path: "/tmp/repo",
      auth: "ambient",
    },
    provider: {
      route: "apiKey",
      name: "alpha",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      valueFile: "/tmp/key",
      confirmCost: true,
    },
    graph: { skip: true },
    ...overrides,
  };
}

/** All-observed facts for a project with one of each object, plus one initiative. */
function observed(overrides: Partial<ObservedFacts> = {}): ObservedFacts {
  return {
    projectsByName: [{ id: "p1", name: "demo" }],
    credentialsByName: [],
    repositoriesByName: [],
    providersByName: [],
    initiatives: [],
    ...overrides,
  };
}

// ── project outcomes ─────────────────────────────────────────────────────────

describe("planSetup — project", () => {
  test("zero projects observed → create", () => {
    const plan = planSetup(observed({ projectsByName: [] }), answers());
    assert.deepEqual(plan.project, { kind: "create" });
  });

  test("exactly one project observed → skip with reason naming id", () => {
    const plan = planSetup(observed(), answers());
    assert.deepEqual(plan.project, {
      kind: "skip",
      reason: 'project "demo" exists (p1)',
    });
  });

  test("two projects sharing the name → ambiguous with both ids ascending", () => {
    const plan = planSetup(
      observed({
        projectsByName: [
          { id: "p2", name: "demo" },
          { id: "p1", name: "demo" },
        ],
      }),
      answers(),
    );
    assert.deepEqual(plan.project, {
      kind: "ambiguous",
      object: "project",
      candidates: ["p1", "p2"],
    });
  });
});

// ── credential outcomes ──────────────────────────────────────────────────────

describe("planSetup — credential", () => {
  test("credential is undefined when auth is ambient", () => {
    const plan = planSetup(observed(), answers());
    assert.equal(plan.credential, undefined);
  });

  test("credential is undefined when auth is ssh-agent", () => {
    const plan = planSetup(
      observed(),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "ssh-agent",
        },
      }),
    );
    assert.equal(plan.credential, undefined);
  });

  test("credential create when auth is https-token and none observed", () => {
    const plan = planSetup(
      observed(),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    assert.deepEqual(plan.credential, { kind: "create" });
  });

  test("credential skip when observed with same id, even if observed provider differs (no drift for credential)", () => {
    const plan = planSetup(
      observed({
        credentialsByName: [{ id: "c1", name: "cred", provider: "gitlab" }],
      }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    assert.deepEqual(plan.credential, {
      kind: "skip",
      reason: 'credential "cred" exists (c1)',
    });
  });

  test("credential ambiguous when two matching observed", () => {
    const plan = planSetup(
      observed({
        credentialsByName: [
          { id: "c2", name: "cred", provider: "github" },
          { id: "c1", name: "cred", provider: "github" },
        ],
      }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    assert.deepEqual(plan.credential, {
      kind: "ambiguous",
      object: "credential",
      candidates: ["c1", "c2"],
    });
  });
});

// ── repository outcomes ──────────────────────────────────────────────────────

describe("planSetup — repository", () => {
  test("repository create when none observed", () => {
    const plan = planSetup(observed(), answers());
    assert.deepEqual(plan.repository, { kind: "create" });
  });

  test("repository ambiguous when two observed", () => {
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r2",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    assert.deepEqual(plan.repository, {
      kind: "ambiguous",
      object: "repository",
      candidates: ["r1", "r2"],
    });
  });

  test("repository skip when one observed and all four fields match", () => {
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    assert.deepEqual(plan.repository, {
      kind: "skip",
      reason: 'repository "repo" matches (r1)',
    });
  });

  test("repository drift on remoteUrl only", () => {
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/other.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    assert.equal(plan.repository.kind, "drift");
    if (plan.repository.kind !== "drift") return;
    assert.equal(plan.repository.object, "repository");
    assert.equal(plan.repository.targetId, "r1");
    assert.deepEqual(plan.repository.fields, [
      {
        field: "remoteUrl",
        expected: "https://git.example.com/owner/repo.git",
        actual: "https://git.example.com/owner/other.git",
      },
    ]);
  });

  test("repository drift on branch only", () => {
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "develop",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    if (plan.repository.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.repository.kind}`);
    }
    assert.deepEqual(plan.repository.fields, [
      { field: "branch", expected: "main", actual: "develop" },
    ]);
  });

  test("repository drift on path only", () => {
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/other",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    if (plan.repository.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.repository.kind}`);
    }
    assert.deepEqual(plan.repository.fields, [
      { field: "path", expected: "/tmp/repo", actual: "/tmp/other" },
    ]);
  });

  test("repository drift on auth only — both ambient are equal, so no drift", () => {
    // Sanity: two ambient sides are equal — no field should appear.
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    assert.equal(plan.repository.kind, "skip");
  });

  test("repository skip on auth when https-token id matches and one credential is observed (string equality)", () => {
    // The previous design always pushed drift in this branch (the
    // answer file carries no credential id, only a name + valueFile).
    // Story 4's "rerun is a no-op" contract requires the comparison to
    // be string-based: when the observed credential id matches the
    // expected lift, the field is equal and the step skips.
    const plan = planSetup(
      observed({
        credentialsByName: [{ id: "c1", name: "cred", provider: "github" }],
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "https-token", credentialId: "c1" },
          },
        ],
      }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    assert.deepEqual(plan.repository, {
      kind: "skip",
      reason: 'repository "repo" matches (r1)',
    });
  });

  test("repository drift on auth when observed credential id does not match expected", () => {
    // Expected: https-token with credentialsByName[0].id = "c1"
    // Observed: https-token with credentialId = "c2" (different id)
    const plan = planSetup(
      observed({
        credentialsByName: [{ id: "c1", name: "cred", provider: "github" }],
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "https-token", credentialId: "c2" },
          },
        ],
      }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    if (plan.repository.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.repository.kind}`);
    }
    assert.deepEqual(plan.repository.fields, [
      {
        field: "auth",
        expected: "https-token(credentialId=c1)",
        actual: "https-token(credentialId=c2)",
      },
    ]);
  });

  test("repository auth equal when both https-token and no observed credential", () => {
    // Both sides https-token, but credentialsByName empty → field is equal.
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "https-token", credentialId: "c-anything" },
          },
        ],
      }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    assert.equal(plan.repository.kind, "skip");
  });

  test("repository drift on auth renders the answers' bare kind when the observed kind differs (no trailing credentialId=)", () => {
    // Story 1 rule 3.4 (01-setup-plan-and-observed-facts.md:176-177): when the
    // kinds differ, the non-paired side (here the answers' https-token, since
    // the observed side is ambient) renders as the bare kind name, never as
    // "https-token(credentialId=)".
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/repo.git",
            branch: "main",
            path: "/tmp/repo",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    if (plan.repository.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.repository.kind}`);
    }
    assert.deepEqual(plan.repository.fields, [
      { field: "auth", expected: "https-token", actual: "ambient" },
    ]);
  });

  test("repository drift with three fields differing — fixed order", () => {
    const plan = planSetup(
      observed({
        repositoriesByName: [
          {
            id: "r1",
            name: "repo",
            remoteUrl: "https://git.example.com/owner/other.git",
            branch: "develop",
            path: "/tmp/other",
            auth: { kind: "ambient" },
          },
        ],
      }),
      answers(),
    );
    if (plan.repository.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.repository.kind}`);
    }
    assert.deepEqual(
      plan.repository.fields.map((f) => f.field),
      ["remoteUrl", "branch", "path"],
    );
  });
});

// ── provider outcomes ────────────────────────────────────────────────────────

describe("planSetup — provider", () => {
  const builtinActive: ObservedFacts = observed({
    providersByName: [
      {
        id: "pr1",
        name: "alpha",
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        baseUrl: null,
        api: null,
        state: "active",
        assignedToProject: true,
      },
    ],
  });

  test("provider create when none observed", () => {
    const plan = planSetup(observed(), answers());
    assert.deepEqual(plan.provider, { kind: "create" });
  });

  test("provider ambiguous when two observed", () => {
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr2",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            baseUrl: null,
            api: null,
            state: "active",
            assignedToProject: true,
          },
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            baseUrl: null,
            api: null,
            state: "active",
            assignedToProject: true,
          },
        ],
      }),
      answers(),
    );
    assert.deepEqual(plan.provider, {
      kind: "ambiguous",
      object: "provider",
      candidates: ["pr1", "pr2"],
    });
  });

  test("provider skip when equivalent, active, and assigned", () => {
    const plan = planSetup(builtinActive, answers());
    assert.deepEqual(plan.provider, {
      kind: "skip",
      reason: 'provider "alpha" matches and is assigned (pr1)',
    });
  });

  test("provider create when observed but logged_out", () => {
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            baseUrl: null,
            api: null,
            state: "logged_out",
            assignedToProject: true,
          },
        ],
      }),
      answers(),
    );
    assert.deepEqual(plan.provider, { kind: "create" });
  });

  test("provider create when equivalent, active, but NOT assigned", () => {
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            baseUrl: null,
            api: null,
            state: "active",
            assignedToProject: false,
          },
        ],
      }),
      answers(),
    );
    assert.deepEqual(plan.provider, { kind: "create" });
  });

  test("provider drift on model only", () => {
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-other",
            baseUrl: null,
            api: null,
            state: "active",
            assignedToProject: true,
          },
        ],
      }),
      answers(),
    );
    if (plan.provider.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.provider.kind}`);
    }
    assert.deepEqual(plan.provider.fields, [
      { field: "model", expected: "gpt-5.6-terra", actual: "gpt-other" },
    ]);
  });

  test("provider drift on baseUrl only (custom route)", () => {
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-completions",
            model: "gpt-5.6-terra",
            baseUrl: "https://api.example.com",
            api: "openai-completions",
            state: "active",
            assignedToProject: true,
          },
        ],
      }),
      answers({
        provider: {
          route: "custom",
          name: "alpha",
          provider: "openai-completions",
          model: "gpt-5.6-terra",
          valueFile: "/tmp/key",
          confirmCost: true,
          baseUrl: "https://api.example.com/v1",
          api: "openai-completions",
        },
      }),
    );
    if (plan.provider.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.provider.kind}`);
    }
    assert.deepEqual(plan.provider.fields, [
      {
        field: "baseUrl",
        expected: "https://api.example.com/v1",
        actual: "https://api.example.com",
      },
    ]);
  });

  test("provider drift on route only — builtin observed, custom requested", () => {
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-completions",
            model: "gpt-5.6-terra",
            baseUrl: "https://api.example.com",
            api: null,
            state: "active",
            assignedToProject: true,
          },
        ],
      }),
      answers({
        provider: {
          route: "custom",
          name: "alpha",
          provider: "openai-completions",
          model: "gpt-5.6-terra",
          valueFile: "/tmp/key",
          confirmCost: true,
          baseUrl: "https://api.example.com",
          api: "openai-completions",
        },
      }),
    );
    if (plan.provider.kind !== "drift") {
      throw new Error(`expected drift, got ${plan.provider.kind}`);
    }
    assert.deepEqual(plan.provider.fields, [
      { field: "route", expected: "custom", actual: "builtin" },
    ]);
  });

  test("provider route oauth vs observed api:null is NOT drift", () => {
    // oauth is the requested route, but observed.api is null → both render as
    // "builtin" because the storage does not distinguish oauth from apiKey.
    // Drift detection is custom vs builtin only.
    const plan = planSetup(
      observed({
        providersByName: [
          {
            id: "pr1",
            name: "alpha",
            provider: "openai-codex",
            model: "gpt-5.6-terra",
            baseUrl: null,
            api: null,
            state: "active",
            assignedToProject: true,
          },
        ],
      }),
      answers({
        provider: {
          route: "oauth",
          name: "alpha",
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          oauthMethod: "device",
        },
      }),
    );
    assert.equal(plan.provider.kind, "skip");
  });
});

// ── project absence fans out to repository/provider create ───────────────────

describe("planSetup — fan-out when no project observed", () => {
  test("zero projects → create for repository, provider, and credential (https-token)", () => {
    const plan = planSetup(
      observed({ projectsByName: [] }),
      answers({
        repository: {
          name: "repo",
          remoteUrl: "https://git.example.com/owner/repo.git",
          branch: "main",
          path: "/tmp/repo",
          auth: "https-token",
        },
        credential: {
          name: "cred",
          provider: "github",
          valueFile: "/tmp/key",
        },
      }),
    );
    assert.equal(plan.project.kind, "create");
    assert.deepEqual(plan.credential, { kind: "create" });
    assert.deepEqual(plan.repository, { kind: "create" });
    assert.deepEqual(plan.provider, { kind: "create" });
  });
});

// ── planGraph ────────────────────────────────────────────────────────────────

describe("planGraph", () => {
  test("skip when graph.skip=true", () => {
    const out = planGraph(
      [{ id: "i1", name: "anything" }],
      answers({ graph: { skip: true } }),
      undefined,
    );
    assert.deepEqual(out, { kind: "skip", reason: "graph.skip=true" });
  });

  test("create when no initiatives exist", () => {
    const out = planGraph(
      [],
      answers({ graph: { skip: false, packagePath: "/tmp/pkg", bind: {} } }),
      "TODO application API",
    );
    assert.deepEqual(out, { kind: "create" });
  });

  test("skip when exactly one matching initiative exists", () => {
    const out = planGraph(
      [{ id: "i1", name: "TODO application API" }],
      answers({ graph: { skip: false, packagePath: "/tmp/pkg", bind: {} } }),
      "TODO application API",
    );
    assert.deepEqual(out, {
      kind: "skip",
      reason: 'initiative "TODO application API" exists (i1)',
    });
  });

  test("ambiguous when two initiatives share the package's initiative name", () => {
    const out = planGraph(
      [
        { id: "i2", name: "TODO application API" },
        { id: "i1", name: "TODO application API" },
      ],
      answers({ graph: { skip: false, packagePath: "/tmp/pkg", bind: {} } }),
      "TODO application API",
    );
    assert.deepEqual(out, {
      kind: "ambiguous",
      object: "graph",
      candidates: ["i1", "i2"],
    });
  });

  test("drift when initiatives exist but none matches, with packagePath field", () => {
    const out = planGraph(
      [
        { id: "i1", name: "Other" },
        { id: "i2", name: "Another" },
      ],
      answers({ graph: { skip: false, packagePath: "/tmp/pkg", bind: {} } }),
      "TODO application API",
    );
    assert.equal(out.kind, "drift");
    if (out.kind !== "drift") return;
    assert.equal(out.object, "graph");
    assert.equal(out.targetId, "i1");
    assert.deepEqual(out.fields, [
      {
        field: "graph.packagePath",
        expected: "TODO application API",
        actual: "Other, Another",
      },
    ]);
  });

  test("throws when graph.skip is false and packageInitiativeName is undefined", () => {
    assert.throws(
      () =>
        planGraph(
          [],
          answers({
            graph: { skip: false, packagePath: "/tmp/pkg", bind: {} },
          }),
          undefined,
        ),
      /packageInitiativeName/,
    );
  });
});
