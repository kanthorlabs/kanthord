import { describe, expect, test } from "vitest";

import type { InitiativeRowDto, ObjectiveRowDto, TaskDetailDto } from "./dto";
import type { ResourceDto } from "./dto";
import type { GateQuery, ScopeMismatchInfo } from "./entity-scope";
import {
  initiativeScope,
  objectiveScope,
  taskScope,
  resourceScope,
  resolveGate,
  siblingTaskHref,
} from "./entity-scope";

// --- initiativeScope ---

describe("initiativeScope", () => {
  test("row present with matching projectId → null", () => {
    const rows: InitiativeRowDto[] = [
      { id: "i1", projectId: "p1", name: "init-1", paused: false },
    ];
    expect(
      initiativeScope({ projectId: "p1", initiativeId: "i1", rows }),
    ).toBeNull();
  });

  test("row absent → level:initiative, actual null, correctHref null", () => {
    const rows: InitiativeRowDto[] = [];
    const result = initiativeScope({
      projectId: "p1",
      initiativeId: "i1",
      rows,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("initiative");
    expect(result!.what).toBe("initiative");
    expect(result!.actual).toBeNull();
    expect(result!.correctHref).toBeNull();
  });

  test("row present with projectId p2 → actual p2, correctHref /project/p2/initiative/i1", () => {
    const rows: InitiativeRowDto[] = [
      { id: "i1", projectId: "p2", name: "init-1", paused: false },
    ];
    const result = initiativeScope({
      projectId: "p1",
      initiativeId: "i1",
      rows,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("initiative");
    expect(result!.actual).toBe("p2");
    expect(result!.correctHref).toBe("/project/p2/initiative/i1");
  });
});

// --- objectiveScope ---

describe("objectiveScope", () => {
  test("row present with matching initiativeId → null", () => {
    const rows: ObjectiveRowDto[] = [
      { id: "o1", initiativeId: "i1", name: "obj-1" },
    ];
    expect(
      objectiveScope({
        projectId: "p1",
        initiativeId: "i1",
        objectiveId: "o1",
        rows,
      }),
    ).toBeNull();
  });

  test("row absent → actual null, correctHref null", () => {
    const rows: ObjectiveRowDto[] = [];
    const result = objectiveScope({
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      rows,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("objective");
    expect(result!.actual).toBeNull();
    expect(result!.correctHref).toBeNull();
  });

  test("row with initiativeId i2 → correctHref /project/p1/initiative/i2/objective/o1", () => {
    const rows: ObjectiveRowDto[] = [
      { id: "o1", initiativeId: "i2", name: "obj-1" },
    ];
    const result = objectiveScope({
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      rows,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("objective");
    expect(result!.actual).toBe("i2");
    expect(result!.correctHref).toBe("/project/p1/initiative/i2/objective/o1");
  });
});

// --- taskScope ---

describe("taskScope", () => {
  test("task.objectiveId matches objectiveId → null", () => {
    const task: TaskDetailDto = {
      id: "t1",
      title: "task-1",
      status: "pending",
      objectiveId: "o1",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    };
    expect(
      taskScope({
        projectId: "p1",
        initiativeId: "i1",
        objectiveId: "o1",
        taskId: "t1",
        task,
        objectiveRows: [{ id: "o1", initiativeId: "i1", name: "obj-1" }],
      }),
    ).toBeNull();
  });

  test("mismatch with real objective in objectiveRows → correctHref computed", () => {
    const task: TaskDetailDto = {
      id: "t1",
      title: "task-1",
      status: "pending",
      objectiveId: "oA",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    };
    const objectiveRows: ObjectiveRowDto[] = [
      { id: "oA", initiativeId: "i1", name: "obj-A" },
    ];
    const result = taskScope({
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "oB",
      taskId: "t1",
      task,
      objectiveRows,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("task");
    expect(result!.actual).toBe("oA");
    expect(result!.expected).toBe("oB");
    expect(result!.correctHref).toBe(
      "/project/p1/initiative/i1/objective/oA/task/t1",
    );
  });

  test("mismatch with objectiveRows empty → correctHref null", () => {
    const task: TaskDetailDto = {
      id: "t1",
      title: "task-1",
      status: "pending",
      objectiveId: "oA",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    };
    const result = taskScope({
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "oB",
      taskId: "t1",
      task,
      objectiveRows: [],
    });
    expect(result).not.toBeNull();
    expect(result!.actual).toBe("oA");
    expect(result!.expected).toBe("oB");
    expect(result!.correctHref).toBeNull();
  });

  test("mismatch with objectiveRows undefined → correctHref null", () => {
    const task: TaskDetailDto = {
      id: "t1",
      title: "task-1",
      status: "pending",
      objectiveId: "oA",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    };
    const result = taskScope({
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "oB",
      taskId: "t1",
      task,
      objectiveRows: undefined,
    });
    expect(result).not.toBeNull();
    expect(result!.actual).toBe("oA");
    expect(result!.expected).toBe("oB");
    expect(result!.correctHref).toBeNull();
  });
});

// --- resourceScope ---

describe("resourceScope", () => {
  test("matching type and projectId → null", () => {
    const resource: ResourceDto = {
      type: "repository",
      id: "r1",
      projectId: "p1",
      name: "repo-1",
      remoteUrl: "https://example.com",
      branch: "main",
      path: ".",
      auth: { kind: "ambient" },
      publication: null,
    };
    expect(
      resourceScope({ projectId: "p1", type: "repository", resource }),
    ).toBeNull();
  });

  test("DTO with no projectId key and matching type → null", () => {
    const resource: ResourceDto = {
      type: "credential",
      id: "c1",
      name: "cred-1",
      provider: "github",
    };
    expect(
      resourceScope({ projectId: "p1", type: "credential", resource }),
    ).toBeNull();
  });

  test("wrong type → level:resource-type, correctHref computed", () => {
    const resource: ResourceDto = {
      type: "repository",
      id: "r1",
      projectId: "p1",
      name: "repo-1",
      remoteUrl: "https://example.com",
      branch: "main",
      path: ".",
      auth: { kind: "ambient" },
      publication: null,
    };
    const result = resourceScope({
      projectId: "p1",
      type: "credential",
      resource,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("resource-type");
    expect(result!.correctHref).toBe("/project/p1/resource/repository/r1");
  });

  test("right type with projectId p2 → level:resource-project, correctHref computed", () => {
    const resource: ResourceDto = {
      type: "repository",
      id: "r1",
      projectId: "p2",
      name: "repo-1",
      remoteUrl: "https://example.com",
      branch: "main",
      path: ".",
      auth: { kind: "ambient" },
      publication: null,
    };
    const result = resourceScope({
      projectId: "p1",
      type: "repository",
      resource,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("resource-project");
    expect(result!.correctHref).toBe("/project/p2/resource/repository/r1");
  });

  test("wrong type AND wrong project → level:resource-type (type wins)", () => {
    const resource: ResourceDto = {
      type: "repository",
      id: "r1",
      projectId: "p2",
      name: "repo-1",
      remoteUrl: "https://example.com",
      branch: "main",
      path: ".",
      auth: { kind: "ambient" },
      publication: null,
    };
    const result = resourceScope({
      projectId: "p1",
      type: "credential",
      resource,
    });
    expect(result).not.toBeNull();
    expect(result!.level).toBe("resource-type");
  });
});

// --- resolveGate ---

describe("resolveGate", () => {
  function q(
    what: string,
    state: GateQuery["state"],
    role: GateQuery["role"],
    message?: string,
  ): GateQuery {
    return { what, state, role, message };
  }

  const mismatch: ScopeMismatchInfo = {
    level: "task",
    what: "task",
    expected: "oB",
    actual: "oA",
    correctHref: null,
  };

  test("ancestor loading before entity error → loading naming the ancestor", () => {
    const result = resolveGate({
      queries: [
        q("project", "loading", "ancestor"),
        q("task", "error", "entity", "boom"),
      ],
      mismatch: null,
    });
    expect(result).toEqual({
      kind: "async",
      state: "loading",
      what: "project",
      message: undefined,
    });
  });

  test("entity missing with non-null mismatch → kind:async state:missing (rule 2 beats rule 5)", () => {
    const result = resolveGate({
      queries: [q("task", "missing", "entity")],
      mismatch,
    });
    expect(result).toEqual({
      kind: "async",
      state: "missing",
      what: "task",
      message: undefined,
    });
  });

  test("ancestor missing → kind:mismatch, level:chain", () => {
    const result = resolveGate({
      queries: [q("initiative", "missing", "ancestor")],
      mismatch: null,
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("mismatch");
    if (result!.kind === "mismatch") {
      expect(result!.info.level).toBe("chain");
      expect(result!.info.what).toBe("initiative");
    }
  });

  test("ancestor error with message boom → kind:async state:error message boom", () => {
    const result = resolveGate({
      queries: [q("project", "error", "ancestor", "boom")],
      mismatch: null,
    });
    expect(result).toEqual({
      kind: "async",
      state: "error",
      what: "project",
      message: "boom",
    });
  });

  test("all resolved with non-null mismatch → kind:mismatch carrying that info", () => {
    const result = resolveGate({
      queries: [
        q("project", "resolved", "ancestor"),
        q("task", "resolved", "entity"),
      ],
      mismatch,
    });
    expect(result).toEqual({ kind: "mismatch", info: mismatch });
  });

  test("all resolved with mismatch null → null", () => {
    const result = resolveGate({
      queries: [
        q("project", "resolved", "ancestor"),
        q("task", "resolved", "entity"),
      ],
      mismatch: null,
    });
    expect(result).toBeNull();
  });

  test("query with state empty and everything else resolved → null", () => {
    const result = resolveGate({
      queries: [
        q("project", "resolved", "ancestor"),
        q("task", "empty", "entity"),
      ],
      mismatch: null,
    });
    expect(result).toBeNull();
  });
});

// --- siblingTaskHref ---

describe("siblingTaskHref", () => {
  const BASE = {
    projectId: "p1",
    initiativeId: "i1",
    objectiveId: "o1",
  };

  test("siblingIds:['tB'] and taskId:'tB' → full path", () => {
    expect(
      siblingTaskHref({
        ...BASE,
        taskId: "tB",
        siblingIds: ["tB"],
      }),
    ).toBe("/project/p1/initiative/i1/objective/o1/task/tB");
  });

  test("siblingIds:[] → null", () => {
    expect(
      siblingTaskHref({
        ...BASE,
        taskId: "tB",
        siblingIds: [],
      }),
    ).toBeNull();
  });

  test("siblingIds:undefined → null", () => {
    expect(
      siblingTaskHref({
        ...BASE,
        taskId: "tB",
        siblingIds: undefined,
      }),
    ).toBeNull();
  });
});
