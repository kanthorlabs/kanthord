// Story S1 — the token layer: six role properties + an exhaustive role map
import { describe, expect, test } from "vitest";
import {
  ROLES,
  roleVar,
  ROLE_CLASS,
  TASK_STATUS_ROLE,
  INITIATIVE_STATUS_ROLE,
  DEPENDENCY_STATE_ROLE,
  EXECUTION_STATE_ROLE,
  BLOCKED_FOREVER_ROLE,
  READINESS_CHECK_STATUS_ROLE,
  PROBE_STATUS_ROLE,
  roleForBlockedForever,
  publicationLabel,
} from "./status-role";

describe("ROLES", () => {
  test("has exactly six members in the expected order", () => {
    expect([...ROLES]).toEqual([
      "neutral",
      "active",
      "attention",
      "blocked",
      "danger",
      "success",
    ]);
  });
});

describe("roleVar", () => {
  test("returns --role-<name> for each of the six roles", () => {
    for (const role of ROLES) {
      const result = roleVar(role);
      expect(result).toMatch(/^--role-/);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test("returns --role-neutral specifically", () => {
    expect(roleVar("neutral")).toBe("--role-neutral");
  });

  test("returns --role-danger specifically", () => {
    expect(roleVar("danger")).toBe("--role-danger");
  });
});

describe("ROLE_CLASS", () => {
  test("has exactly the same keys as ROLES", () => {
    expect(Object.keys(ROLE_CLASS)).toEqual([...ROLES]);
  });

  test("every value is a non-empty string containing text-role-<role>", () => {
    for (const role of ROLES) {
      const cls = ROLE_CLASS[role];
      expect(cls).toBeTruthy();
      expect(cls).toContain(`text-role-${role}`);
    }
  });
});

describe("task status role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(TASK_STATUS_ROLE).sort();
    expect(keys).toEqual([
      "awaiting_confirmation",
      "completed",
      "discarded",
      "failed",
      "pending",
      "running",
    ]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(TASK_STATUS_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("initiative status role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(INITIATIVE_STATUS_ROLE).sort();
    expect(keys).toEqual(["building", "discarded", "landed"]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(INITIATIVE_STATUS_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("dependency state role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(DEPENDENCY_STATE_ROLE).sort();
    expect(keys).toEqual(["blocked", "ready"]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(DEPENDENCY_STATE_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("execution state role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(EXECUTION_STATE_ROLE).sort();
    expect(keys).toEqual(["paused", "runnable"]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(EXECUTION_STATE_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("blocked forever role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(BLOCKED_FOREVER_ROLE).sort();
    expect(keys).toEqual(["false", "true"]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(BLOCKED_FOREVER_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("readiness check status role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(READINESS_CHECK_STATUS_ROLE).sort();
    expect(keys).toEqual([
      "blocked",
      "failed",
      "missing",
      "multiple",
      "ok",
      "paused",
      "running",
      "stopped",
      "unsupported",
      "unverified",
    ]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(READINESS_CHECK_STATUS_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("probe status role map", () => {
  test("key set matches the exact union members", () => {
    const keys = Object.keys(PROBE_STATUS_ROLE).sort();
    expect(keys).toEqual(["failed", "ok"]);
  });

  test("every value is a member of ROLES", () => {
    for (const role of Object.values(PROBE_STATUS_ROLE)) {
      expect(ROLES).toContain(role);
    }
  });
});

describe("roleForBlockedForever", () => {
  test("true maps to danger", () => {
    expect(roleForBlockedForever(true)).toBe("danger");
  });

  test("false maps to neutral", () => {
    expect(roleForBlockedForever(false)).toBe("neutral");
  });
});

describe("publicationLabel", () => {
  test("published with remoteOID returns published@<oid>", () => {
    expect(
      publicationLabel({ state: "published", remoteOID: "deadbeef" }),
    ).toBe("published@deadbeef");
  });

  test("published with null remoteOID returns published", () => {
    expect(publicationLabel({ state: "published", remoteOID: null })).toBe(
      "published",
    );
  });

  test("unpublished with null remoteOID returns unpublished", () => {
    expect(publicationLabel({ state: "unpublished", remoteOID: null })).toBe(
      "unpublished",
    );
  });

  test("diverged with remoteOID returns diverged", () => {
    expect(publicationLabel({ state: "diverged", remoteOID: "abc" })).toBe(
      "diverged",
    );
  });
});

describe("publication has no role mapping", () => {
  test("none of the seven role maps contain publication keys", () => {
    const allMaps = [
      TASK_STATUS_ROLE,
      INITIATIVE_STATUS_ROLE,
      DEPENDENCY_STATE_ROLE,
      EXECUTION_STATE_ROLE,
      BLOCKED_FOREVER_ROLE,
      READINESS_CHECK_STATUS_ROLE,
      PROBE_STATUS_ROLE,
    ];
    for (const map of allMaps) {
      expect(Object.keys(map)).not.toContain("publication");
      expect(Object.keys(map)).not.toContain("published");
    }
  });
});
