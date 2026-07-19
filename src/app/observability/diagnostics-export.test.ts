import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { DiagnosticsExport } from "./diagnostics-export.ts";
import { validateSafeFactsRecord } from "../../domain/safe-facts.ts";

// ---- Fake implementations for hermetic tests ----

type FakeEvent = {
  id: string;
  type: string;
  taskId: string;
  payload?: Record<string, string>;
};

function makeFakeEventReader(events: FakeEvent[]) {
  return {
    readAfter(_cursor: string, _limit?: number): FakeEvent[] {
      return events;
    },
  };
}

function makeFakeTaskReader(initiativeId: string, taskIds: string[]) {
  return {
    getInitiativeId(taskId: string): string | undefined {
      if (taskIds.includes(taskId)) return initiativeId;
      return undefined;
    },
    listByInitiative(iniId: string): Array<{ id: string }> {
      if (iniId === initiativeId) return taskIds.map((id) => ({ id }));
      return [];
    },
  };
}

// Stable in-memory ObservabilityRefs — assigns opaque refs that are NOT the
// real entity ids, reuses them on repeated calls for the same entity id.
class InMemoryRefs {
  readonly #taskMap = new Map<string, string>();
  readonly #iniMap = new Map<string, string>();
  readonly #sessionMap = new Map<string, string>();
  #counter = 0;

  getOrCreateTaskRef(taskId: string): string {
    if (!this.#taskMap.has(taskId)) {
      this.#taskMap.set(taskId, `opaque-task-${++this.#counter}`);
    }
    return this.#taskMap.get(taskId)!;
  }

  getOrCreateInitiativeRef(initiativeId: string): string {
    if (!this.#iniMap.has(initiativeId)) {
      this.#iniMap.set(initiativeId, `opaque-ini-${++this.#counter}`);
    }
    return this.#iniMap.get(initiativeId)!;
  }

  getOrCreateSessionRef(runKey: string): string {
    if (!this.#sessionMap.has(runKey)) {
      this.#sessionMap.set(runKey, `opaque-sess-${++this.#counter}`);
    }
    return this.#sessionMap.get(runKey)!;
  }
}

function makeFakeWriteFile() {
  const written: Array<{ path: string; data: string; mode: number }> = [];
  const fn = async (
    path: string,
    data: string,
    opts: { mode: number },
  ): Promise<void> => {
    written.push({ path, data, mode: opts.mode });
  };
  return { fn, written };
}

// ---- Tests ----

test("(a) canary: sk-canary-999, /home/user/secret-repo, npm test, TASK-CANARY-123 absent from serialized output", async () => {
  const REAL_TASK_ID = "TASK-CANARY-123";
  const INI_ID = "INI-CANARY-1";

  // Events carry sensitive values in their payloads.
  // The closed projection must NEVER copy these into SafeFactsRecord fields.
  const events: FakeEvent[] = [
    {
      id: "01JTEST0000001",
      type: "agent.finished",
      taskId: REAL_TASK_ID,
      // reason: "sk-canary-999" must map to "internal_unclassified" — never copied verbatim
      payload: { outcome: "failed", reason: "sk-canary-999" },
    },
    {
      id: "01JTEST0000002",
      type: "agent.started",
      taskId: REAL_TASK_ID,
      // workspace: "/home/user/secret-repo" is not a SafeFactsRecord field — must be absent
      payload: { workspace: "/home/user/secret-repo" },
    },
    {
      id: "01JTEST0000003",
      type: "task.verification",
      taskId: REAL_TASK_ID,
      // command: "npm test --reporter=spec" must NOT be copied into the output
      payload: {
        verifierKind: "cmd",
        phase: "start",
        command: "npm test --reporter=spec",
      },
    },
  ];

  const fw = makeFakeWriteFile();
  const uc = new DiagnosticsExport(
    makeFakeEventReader(events),
    makeFakeTaskReader(INI_ID, [REAL_TASK_ID]),
    new InMemoryRefs(),
    fw.fn,
  );

  await uc.execute({ initiativeId: INI_ID, outPath: "/tmp/canary.json" });

  assert.ok(
    fw.written.length > 0,
    "writeFile must have been called at least once",
  );
  const serialized = fw.written[0]!.data;

  assert.ok(
    !serialized.includes("sk-canary-999"),
    "credential value 'sk-canary-999' must NOT appear in the export",
  );
  assert.ok(
    !serialized.includes("/home/user/secret-repo"),
    "path '/home/user/secret-repo' must NOT appear in the export",
  );
  assert.ok(
    !serialized.includes("npm test"),
    "command 'npm test' must NOT appear in the export",
  );
  assert.ok(
    !serialized.includes(REAL_TASK_ID),
    "real task id 'TASK-CANARY-123' must NOT appear — opaque ref used instead",
  );
});

test("(b) ref-stability: same initiativeId produces same taskRef and initiativeRef across two calls", async () => {
  const TASK_ID = "TASK-STABLE-1";
  const INI_ID = "INI-STABLE-1";
  const events: FakeEvent[] = [
    {
      id: "01JTEST0000010",
      type: "task.started",
      taskId: TASK_ID,
    },
  ];

  const fw1 = makeFakeWriteFile();
  const fw2 = makeFakeWriteFile();
  // Shared refs object — same entity → same ref across both calls.
  const refs = new InMemoryRefs();
  const reader = makeFakeTaskReader(INI_ID, [TASK_ID]);

  const uc1 = new DiagnosticsExport(
    makeFakeEventReader(events),
    reader,
    refs,
    fw1.fn,
  );
  const uc2 = new DiagnosticsExport(
    makeFakeEventReader(events),
    reader,
    refs,
    fw2.fn,
  );

  await uc1.execute({ initiativeId: INI_ID, outPath: "/tmp/stable1.json" });
  await uc2.execute({ initiativeId: INI_ID, outPath: "/tmp/stable2.json" });

  assert.ok(
    fw1.written.length > 0 && fw2.written.length > 0,
    "both writes must occur",
  );
  const out1 = JSON.parse(fw1.written[0]!.data) as {
    initiativeRef: string;
    records: Array<{ taskRef: string }>;
  };
  const out2 = JSON.parse(fw2.written[0]!.data) as {
    initiativeRef: string;
    records: Array<{ taskRef: string }>;
  };

  assert.strictEqual(
    out1.initiativeRef,
    out2.initiativeRef,
    "initiativeRef must be identical across two calls with the same initiativeId",
  );
  assert.ok(
    out1.records.length > 0 && out2.records.length > 0,
    "both exports must have records",
  );
  assert.strictEqual(
    out1.records[0]!.taskRef,
    out2.records[0]!.taskRef,
    "taskRef must be identical across two calls for the same task",
  );
});

test("(c) seq-contiguous: 5 agent.progress events for one task produce seq [1,2,3,4,5]", async () => {
  const TASK_ID = "TASK-SEQ-1";
  const INI_ID = "INI-SEQ-1";
  // 5 agent.progress events → 5 agent.tool records → seq must be [1,2,3,4,5]
  const events: FakeEvent[] = [
    {
      id: "01JTEST0000020",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Read" },
    },
    {
      id: "01JTEST0000021",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Write" },
    },
    {
      id: "01JTEST0000022",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Bash" },
    },
    {
      id: "01JTEST0000023",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Grep" },
    },
    {
      id: "01JTEST0000024",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Read" },
    },
  ];

  const fw = makeFakeWriteFile();
  const uc = new DiagnosticsExport(
    makeFakeEventReader(events),
    makeFakeTaskReader(INI_ID, [TASK_ID]),
    new InMemoryRefs(),
    fw.fn,
  );

  await uc.execute({ initiativeId: INI_ID, outPath: "/tmp/seq.json" });

  assert.ok(fw.written.length > 0, "writeFile must have been called");
  const out = JSON.parse(fw.written[0]!.data) as {
    records: Array<{ seq: number }>;
  };
  assert.strictEqual(out.records.length, 5, "exactly 5 records expected");
  const seqs = out.records.map((r) => r.seq);
  assert.deepStrictEqual(
    seqs,
    [1, 2, 3, 4, 5],
    "seq values must be [1,2,3,4,5]",
  );
});

test("(d) schema-valid: all output records pass validateSafeFactsRecord without throwing", async () => {
  const TASK_ID = "TASK-VALID-1";
  const INI_ID = "INI-VALID-1";
  const events: FakeEvent[] = [
    { id: "01JTEST0000030", type: "task.started", taskId: TASK_ID },
    {
      id: "01JTEST0000031",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Read" },
    },
    {
      id: "01JTEST0000032",
      type: "task.verification",
      taskId: TASK_ID,
      payload: {
        verifierKind: "cmd",
        phase: "end",
        exitClass: "pass",
        durationMs: "123",
        timedOut: "false",
      },
    },
    { id: "01JTEST0000033", type: "task.completed", taskId: TASK_ID },
  ];

  const fw = makeFakeWriteFile();
  const uc = new DiagnosticsExport(
    makeFakeEventReader(events),
    makeFakeTaskReader(INI_ID, [TASK_ID]),
    new InMemoryRefs(),
    fw.fn,
  );

  await uc.execute({ initiativeId: INI_ID, outPath: "/tmp/valid.json" });

  assert.ok(fw.written.length > 0, "writeFile must have been called");
  const out = JSON.parse(fw.written[0]!.data) as {
    records: unknown[];
  };
  assert.ok(Array.isArray(out.records), "records must be an array");
  assert.ok(out.records.length > 0, "at least one record expected");
  for (const record of out.records) {
    // validateSafeFactsRecord throws SchemaValidationError on invalid records;
    // must not throw for any record produced by the use case.
    validateSafeFactsRecord(record);
  }
});

test("(e) import-restriction canary: only diagnostics-export.ts may import from domain/safe-facts", () => {
  // Grep production sources (excluding *.test.ts and src/domain/safe-facts.ts
  // itself) for any import of domain/safe-facts.  The ONLY allowed production
  // importer is src/app/observability/diagnostics-export.ts (app→domain is
  // permitted by boundaries config).  Any other importer is a violation.
  let out: string;
  try {
    out = execSync(
      `grep -rE "from.*domain/safe-facts" src --include='*.ts' --exclude='*.test.ts' -l`,
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
  } catch {
    // grep exits non-zero when no lines match — treat as empty
    out = "";
  }

  // Exclude the module itself (safe-facts.ts does not import itself, but guard
  // against any grep artifact).
  const files = out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.endsWith("src/domain/safe-facts.ts"));

  // Non-vacuousness: at least one production importer must exist so the loop
  // below cannot pass vacuously on an empty list.  If grep returns nothing the
  // pattern is broken or the production importer moved without updating this canary.
  assert.ok(
    files.length > 0,
    `import-restriction canary found zero production importers of domain/safe-facts — ` +
      `expected at least src/app/observability/diagnostics-export.ts; check the grep pattern`,
  );

  const ALLOWED = "src/app/observability/diagnostics-export.ts";
  for (const f of files) {
    assert.ok(
      f.endsWith(ALLOWED),
      `Import restriction violated: '${f}' imports from domain/safe-facts ` +
        `but is not the allowed diagnostics-export.ts`,
    );
  }

  // Negative check: verify the assertion logic detects a hypothetical second importer.
  const hypothetical = [...files, "src/app/other/bad-importer.ts"];
  let wouldDetect = false;
  for (const f of hypothetical) {
    if (!f.endsWith(ALLOWED)) {
      wouldDetect = true;
      break;
    }
  }
  assert.ok(
    wouldDetect,
    "assertion logic must detect a hypothetical second importer as a violation (sensitivity check)",
  );
});
