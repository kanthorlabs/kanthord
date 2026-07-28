// src/apps/cli/setup/drift-report.test.ts — EPIC 015 Story 3
// Hermetic, pure tests for `formatDriftReport` and `formatAmbiguousReport`.
// The drift report is the wizard's only signal to the user that "your
// answers describe a project that is not the one that exists". The test
// cases are pinned to the exact line format enumerated in Story 3 — they
// are what Phase I of the Proof greps for ("drift|differs|expected").
//
// Why pure: the formatter never touches the database; every line is a
// function of the `StepOutcome` it received. Keeping it pure lets the
// test assert exact text without spinning up a fake repo / provider /
// project. Story 4 pushes the returned lines onto `stderr` verbatim.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatAmbiguousReport, formatDriftReport } from "./drift-report.ts";
import type { DriftContext } from "./drift-report.ts";
import { planGraph, planSetup } from "../../../app/project/setup-plan.ts";
import type {
  DriftField,
  ObservedFacts,
  SetupAnswers,
  SetupObject,
  StepOutcome,
} from "../../../app/project/setup-plan.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

const ctx: DriftContext = {
  projectId: "prj-1",
  packagePath: "/srv/g",
};

function drift(
  object: SetupObject,
  targetId: string,
  fields: DriftField[],
): Extract<StepOutcome, { kind: "drift" }> {
  return { kind: "drift", object, targetId, fields };
}

function ambiguous(
  object: SetupObject,
  candidates: string[],
): Extract<StepOutcome, { kind: "ambiguous" }> {
  return { kind: "ambiguous", object, candidates };
}

// ── Repository drift — one field ─────────────────────────────────────────────

describe("formatDriftReport — repository, one field", () => {
  test("drifted remoteUrl produces three lines, header includes drift + 1 field(s) differ", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        { field: "remoteUrl", expected: "EXPECTED_URL", actual: "ACTUAL_URL" },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /drift/);
    assert.match(lines[0]!, /repository/);
    assert.match(lines[0]!, /1 field\(s\) differ/);
    assert.equal(
      lines[1],
      "  remoteUrl: expected EXPECTED_URL, actual ACTUAL_URL",
    );
    assert.equal(
      lines[2],
      "remediation: kanthord update repository --id rep-1 --remote-url EXPECTED_URL --reclone",
    );
  });

  test("drifted branch has --branch and does NOT include --reclone", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        {
          field: "branch",
          expected: "expected-branch",
          actual: "actual-branch",
        },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.match(lines[2]!, /--branch expected-branch/);
    assert.doesNotMatch(lines[2]!, /--reclone/);
    assert.doesNotMatch(lines[2]!, /--remote-url/);
  });
});

// ── Repository drift — multi-field remediation branch ────────────────────────

describe("formatDriftReport — repository, multi-field", () => {
  test("remoteUrl + branch carry both flags AND --reclone", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        { field: "remoteUrl", expected: "EXPECTED_URL", actual: "ACTUAL_URL" },
        { field: "branch", expected: "main", actual: "dev" },
      ]),
      ctx,
    );

    assert.equal(lines.length, 4);
    assert.match(lines[3]!, /--remote-url EXPECTED_URL/);
    assert.match(lines[3]!, /--branch main/);
    assert.match(lines[3]!, /--reclone/);
  });

  test("drifted path uses the no-flag remediation line", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        { field: "path", expected: "/a", actual: "/b" },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.match(lines[2]!, /no flag exists on 'update repository' for path/);
    assert.doesNotMatch(lines[2]!, /--remote-url/);
    assert.doesNotMatch(lines[2]!, /--branch/);
    assert.doesNotMatch(lines[2]!, /--reclone/);
  });

  test("drifted auth uses the no-flag remediation line", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        {
          field: "auth",
          expected: "https-token(credentialId=crd-1)",
          actual: "https-token(credentialId=crd-9)",
        },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.match(
      lines[2]!,
      /no flag exists on 'update repository' for path\/auth/,
    );
    assert.doesNotMatch(lines[2]!, /--remote-url/);
  });

  test("remoteUrl + path also takes the no-flag branch (path forces it)", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        { field: "remoteUrl", expected: "EXPECTED_URL", actual: "ACTUAL_URL" },
        { field: "path", expected: "/a", actual: "/b" },
      ]),
      ctx,
    );

    assert.equal(lines.length, 4);
    assert.match(
      lines[3]!,
      /no flag exists on 'update repository' for path\/auth/,
    );
    assert.doesNotMatch(lines[3]!, /--reclone/);
  });

  test("three drifted repository fields emit five lines, in the same order as fields", () => {
    const fields: DriftField[] = [
      { field: "remoteUrl", expected: "E1", actual: "A1" },
      { field: "branch", expected: "E2", actual: "A2" },
      { field: "path", expected: "E3", actual: "A3" },
    ];
    const lines = formatDriftReport(drift("repository", "rep-1", fields), ctx);

    assert.equal(lines.length, 5);
    assert.match(lines[0]!, /3 field\(s\) differ/);
    assert.equal(lines[1], "  remoteUrl: expected E1, actual A1");
    assert.equal(lines[2], "  branch: expected E2, actual A2");
    assert.equal(lines[3], "  path: expected E3, actual A3");
    // path/auth branch — no flag remediation.
    assert.match(
      lines[4]!,
      /no flag exists on 'update repository' for path\/auth/,
    );
  });
});

// ── Provider drift ───────────────────────────────────────────────────────────

describe("formatDriftReport — provider", () => {
  test("drifted model emits the remove ai-provider --cascade remediation", () => {
    const lines = formatDriftReport(
      drift("provider", "prv-1", [
        { field: "model", expected: "gpt-5.6-sol", actual: "gpt-4o" },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /drift/);
    assert.match(lines[0]!, /provider/);
    assert.equal(lines[1], "  model: expected gpt-5.6-sol, actual gpt-4o");
    assert.equal(
      lines[2],
      "remediation: kanthord remove ai-provider --id prv-1 --cascade",
    );
  });

  test("drifted route renders 'expected custom, actual builtin'", () => {
    const lines = formatDriftReport(
      drift("provider", "prv-1", [
        { field: "route", expected: "custom", actual: "builtin" },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.equal(lines[1], "  route: expected custom, actual builtin");
    assert.match(lines[2]!, /remediation: kanthord remove ai-provider/);
  });
});

// ── Graph drift ──────────────────────────────────────────────────────────────

describe("formatDriftReport — graph", () => {
  test("drifted graph.packagePath emits the import graph --create remediation", () => {
    const lines = formatDriftReport(
      drift("graph", "ini-1", [
        {
          field: "graph.packagePath",
          expected: "TODO application API",
          actual: "Other initiative",
        },
      ]),
      ctx,
    );

    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /drift/);
    assert.match(lines[0]!, /graph/);
    assert.equal(
      lines[1],
      "  graph.packagePath: expected TODO application API, actual Other initiative",
    );
    assert.equal(
      lines[2],
      "remediation: kanthord import graph --create --dir /srv/g --project prj-1",
    );
  });
});

// ── Throws for objects with no drift fields ──────────────────────────────────

describe("formatDriftReport — throws", () => {
  test("throws when object is 'project'", () => {
    assert.throws(
      () => formatDriftReport(drift("project" as never, "prj-1", []), ctx),
      /formatDriftReport: project has no drift fields/,
    );
  });

  test("throws when object is 'credential'", () => {
    assert.throws(
      () => formatDriftReport(drift("credential" as never, "crd-1", []), ctx),
      /formatDriftReport: credential has no drift fields/,
    );
  });
});

// ── Ambiguous ────────────────────────────────────────────────────────────────

describe("formatAmbiguousReport", () => {
  test("three candidates return two lines, joined by ', ' in given order", () => {
    const lines = formatAmbiguousReport(
      ambiguous("project", ["01H_ALPHA", "01H_BETA", "01H_GAMMA"]),
      ctx,
    );

    assert.equal(lines.length, 2);
    assert.equal(lines[0], "error: ambiguous project: 3 candidates");
    assert.equal(lines[1], "  candidates: 01H_ALPHA, 01H_BETA, 01H_GAMMA");
  });

  test("two candidates produce the same shape with '2 candidates'", () => {
    const lines = formatAmbiguousReport(
      ambiguous("provider", ["01H_P1", "01H_P2"]),
      ctx,
    );

    assert.equal(lines.length, 2);
    assert.equal(lines[0], "error: ambiguous provider: 2 candidates");
    assert.equal(lines[1], "  candidates: 01H_P1, 01H_P2");
  });
});

// ── Hygiene: no `run daemon`, no secret field names in `DriftField` ──────────

describe("formatDriftReport / formatAmbiguousReport — hygiene", () => {
  test("no output line from any of the above cases contains 'run daemon'", () => {
    const outputs: string[][] = [
      formatDriftReport(
        drift("repository", "rep-1", [
          { field: "remoteUrl", expected: "E", actual: "A" },
        ]),
        ctx,
      ),
      formatDriftReport(
        drift("repository", "rep-1", [
          { field: "branch", expected: "E", actual: "A" },
        ]),
        ctx,
      ),
      formatDriftReport(
        drift("repository", "rep-1", [
          { field: "path", expected: "E", actual: "A" },
        ]),
        ctx,
      ),
      formatDriftReport(
        drift("provider", "prv-1", [
          { field: "model", expected: "E", actual: "A" },
        ]),
        ctx,
      ),
      formatDriftReport(
        drift("graph", "ini-1", [
          { field: "graph.packagePath", expected: "E", actual: "A" },
        ]),
        ctx,
      ),
      formatAmbiguousReport(ambiguous("project", ["01H_A", "01H_B"]), ctx),
    ];

    for (const lines of outputs) {
      for (const line of lines) {
        assert.doesNotMatch(
          line,
          /run daemon/,
          `line must not mention 'run daemon': ${line}`,
        );
      }
    }
  });

  test("'drift' and 'expected' and 'differ' all appear in the output for a repository drift", () => {
    const lines = formatDriftReport(
      drift("repository", "rep-1", [
        { field: "remoteUrl", expected: "E", actual: "A" },
      ]),
      ctx,
    );

    const joined = lines.join("\n");
    assert.match(joined, /drift/);
    assert.match(joined, /expected/);
    assert.match(joined, /differ/);
  });

  test("every DriftField name produced by planSetup/planGraph is in the closed set pinned by Story 3", () => {
    // Story 3 Constraints: "the drifted fields are exactly remoteUrl, branch,
    // path, auth, model, baseUrl, route, graph.packagePath." This drives the
    // real planners (not hand-built StepOutcome fixtures) so a planner that
    // starts emitting an unpinned field name is caught here.
    const closedSet = [
      "remoteUrl",
      "branch",
      "path",
      "auth",
      "model",
      "baseUrl",
      "route",
      "graph.packagePath",
    ];

    const repoAnswers: SetupAnswers = {
      project: { name: "demo" },
      repository: {
        name: "repo",
        remoteUrl: "https://git.example.com/owner/repo.git",
        branch: "main",
        path: "/tmp/repo",
        auth: "https-token",
      },
      credential: { name: "cred", provider: "github", valueFile: "/tmp/key" },
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
      graph: { skip: true },
    };
    const repoFacts: ObservedFacts = {
      projectsByName: [{ id: "p1", name: "demo" }],
      credentialsByName: [{ id: "c1", name: "cred", provider: "github" }],
      repositoriesByName: [
        {
          id: "r1",
          name: "repo",
          remoteUrl: "https://git.example.com/owner/other.git",
          branch: "develop",
          path: "/tmp/other",
          auth: { kind: "https-token", credentialId: "c2" },
        },
      ],
      providersByName: [
        {
          id: "pr1",
          name: "alpha",
          provider: "openai-completions",
          model: "gpt-other",
          baseUrl: "https://api.example.com",
          api: null,
          state: "active",
          assignedToProject: true,
        },
      ],
      initiatives: [],
    };

    const plan = planSetup(repoFacts, repoAnswers);
    if (plan.repository.kind !== "drift") {
      throw new Error(`expected repository drift, got ${plan.repository.kind}`);
    }
    if (plan.provider.kind !== "drift") {
      throw new Error(`expected provider drift, got ${plan.provider.kind}`);
    }
    // Sanity: this fixture must actually exercise all four repository fields
    // and all three provider fields, or the closed-set assertion below would
    // be checking an empty/partial set.
    assert.deepEqual(plan.repository.fields.map((f) => f.field).sort(), [
      "auth",
      "branch",
      "path",
      "remoteUrl",
    ]);
    assert.deepEqual(plan.provider.fields.map((f) => f.field).sort(), [
      "baseUrl",
      "model",
      "route",
    ]);

    const graphOutcome = planGraph(
      [{ id: "i1", name: "other-initiative" }],
      {
        ...repoAnswers,
        graph: { skip: false, packagePath: "/srv/g", bind: {} },
      },
      "wanted-initiative",
    );
    if (graphOutcome.kind !== "drift") {
      throw new Error(`expected graph drift, got ${graphOutcome.kind}`);
    }

    const producedFields = [
      ...plan.repository.fields,
      ...plan.provider.fields,
      ...graphOutcome.fields,
    ].map((f) => f.field);

    assert.ok(producedFields.length > 0, "the fixture must produce fields");
    for (const field of producedFields) {
      assert.ok(
        closedSet.includes(field),
        `field "${field}" produced by a planner is not in Story 3's closed set`,
      );
    }
  });
});
