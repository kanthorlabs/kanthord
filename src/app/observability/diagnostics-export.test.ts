import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DiagnosticsExport } from "./diagnostics-export.ts";
import { validateSafeFactsRecord } from "../../domain/safe-facts.ts";

type SafeFactsExportDoc = {
  schemaVersion: number;
  exportedAt: string;
  initiativeRef: string;
  records: unknown[];
};

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

// ─── Story S3 — build/execute split ─────────────────────────────────────────

test("021 S3: build returns a document with exactly the four keys, sorted, and no outPath", async () => {
  const TASK_ID = "TASK-BUILD-1";
  const INI_ID = "INI-BUILD-1";
  const events: FakeEvent[] = [
    { id: "01JTEST0000040", type: "task.started", taskId: TASK_ID },
  ];

  const uc = new DiagnosticsExport(
    makeFakeEventReader(events),
    makeFakeTaskReader(INI_ID, [TASK_ID]),
    new InMemoryRefs(),
    makeFakeWriteFile().fn,
  );

  const doc = (await uc.build({
    initiativeId: INI_ID,
  })) as unknown as SafeFactsExportDoc;

  assert.deepEqual(
    Object.keys(doc).sort(),
    ["exportedAt", "initiativeRef", "records", "schemaVersion"],
    "build's document has exactly these four keys",
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(doc, "outPath"),
    "build's document must never carry outPath",
  );
});

test("021 S3: execute writes the same document build() returns, with mode 0o600 at the given path", async () => {
  const TASK_ID = "TASK-SAME-1";
  const INI_ID = "INI-SAME-1";
  const events: FakeEvent[] = [
    { id: "01JTEST0000041", type: "task.started", taskId: TASK_ID },
    {
      id: "01JTEST0000042",
      type: "agent.progress",
      taskId: TASK_ID,
      payload: { tool: "Read" },
    },
  ];

  const refs = new InMemoryRefs();
  const fwExecute = makeFakeWriteFile();
  const ucExecute = new DiagnosticsExport(
    makeFakeEventReader(events),
    makeFakeTaskReader(INI_ID, [TASK_ID]),
    refs,
    fwExecute.fn,
  );
  const ucBuild = new DiagnosticsExport(
    makeFakeEventReader(events),
    makeFakeTaskReader(INI_ID, [TASK_ID]),
    refs,
    makeFakeWriteFile().fn,
  );

  const outPath = "/tmp/same.json";
  const result = await ucExecute.execute({ initiativeId: INI_ID, outPath });
  const built = (await ucBuild.build({
    initiativeId: INI_ID,
  })) as unknown as SafeFactsExportDoc;

  assert.equal(fwExecute.written.length, 1, "execute writes exactly once");
  const written = fwExecute.written[0]!;
  const executed = JSON.parse(written.data) as SafeFactsExportDoc;

  // exportedAt is a fresh timestamp per call (each record's own timestamp is
  // pinned to that same per-call exportedAt), and sessionRef is a fresh opaque
  // id per call (pre-existing `newId()`-per-run behaviour, unrelated to this
  // story) — pin all three to a fixed sentinel before comparing the rest of
  // the document byte-for-byte.
  executed.exportedAt = "SENTINEL";
  built.exportedAt = "SENTINEL";
  for (const record of executed.records as Array<Record<string, unknown>>) {
    record["sessionRef"] = "SENTINEL_SESSION";
    record["timestamp"] = "SENTINEL";
  }
  for (const record of built.records as Array<Record<string, unknown>>) {
    record["sessionRef"] = "SENTINEL_SESSION";
    record["timestamp"] = "SENTINEL";
  }
  assert.deepEqual(executed, built, "execute writes exactly what build built");

  assert.equal(written.path, outPath, "execute writes to the given outPath");
  assert.equal(written.mode, 0o600, "execute writes with mode 0o600");

  assert.equal(
    result.recordCount,
    executed.records.length,
    "recordCount matches the written document's records length",
  );
  assert.equal(result.outPath, outPath);
  assert.deepEqual(
    result.preview,
    [
      { kind: "task.lifecycle", count: 1 },
      { kind: "agent.tool", count: 1 },
    ],
    "preview keeps first-seen kind order, unchanged by the build/execute split",
  );
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

test("021 review-blocker S2: diagnostics-export.ts contains no unsound double-cast to SafeFactsRecord[]", () => {
  // Review blocker S2: `records.map(serializeSafeFactsRecord) as unknown as
  // SafeFactsRecord[]` asserts a type the value does not have —
  // `serializeSafeFactsRecord` returns `Record<string, unknown>`
  // (src/domain/safe-facts.ts), not `SafeFactsRecord`. The fix must remove the
  // `as unknown as` escape hatch entirely (either type the export's `records`
  // as the serialized shape, or keep domain records through `build` and
  // serialize only at the write/present boundary) — either way this exact
  // substring must disappear from the file.
  const src = readFileSync(
    join(process.cwd(), "src/app/observability/diagnostics-export.ts"),
    "utf8",
  );

  // Sensitivity check first: prove the search string is not stale by
  // confirming a deliberately-constructed sample containing it IS detected.
  const sample = "records.map(f) as unknown as SafeFactsRecord[];";
  assert.ok(
    sample.includes("as unknown as SafeFactsRecord[]"),
    "sensitivity check broken: the detector does not even match its own sample string",
  );

  assert.ok(
    !src.includes("as unknown as SafeFactsRecord[]"),
    "diagnostics-export.ts still contains the unsound double-cast " +
      "`as unknown as SafeFactsRecord[]` — remove it per review blocker S2",
  );
});
