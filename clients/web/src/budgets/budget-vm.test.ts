/**
 * budget-vm adapter unit tests.
 *
 * The adapter `toBudgetVM` maps the proto `GetBudgetResponse` to `BudgetVM`.
 * The adapter `toBudgetsVM` maps `ListBudgetsResponse` (budgets: GetBudgetResponse[])
 * to `BudgetVM[]` — the list variant that the Budgets page layer will use once
 * ListBudgets is wired through the DaemonClient.
 *
 * Adapter contract:
 *   toBudgetVM(proto: GetBudgetResponse): BudgetVM
 *     taskId       → proto.taskId
 *     spent        → proto.spent
 *     ceiling      → proto.ceiling
 *     breakerState → proto.breakerState
 *     override     → when proto.override is undefined: { present:false, amount:0, reason:"", actor:"" }
 *                    when proto.override is defined: { present, amount, reason, actor } passthrough
 *
 *   toBudgetsVM(response: ListBudgetsResponse): BudgetVM[]
 *     maps each response.budgets[i] through toBudgetVM
 *
 * RED: fails because toBudgetVM and toBudgetsVM do not exist in budget-vm.ts.
 */
import { describe, it, expect } from "vitest";
import { toBudgetVM, toBudgetsVM } from "@/budgets/budget-vm";
import type { BudgetVM } from "@/budgets/budget-vm";
import type { GetBudgetResponse, BudgetOverrideInfo, ListBudgetsResponse } from "@/gen/kanthord/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Proto fixtures (plain objects cast — test-only pattern)
// ---------------------------------------------------------------------------

function makeProtoOverride(
  overrides: Partial<{
    present: boolean;
    amount: number;
    reason: string;
    actor: string;
  }> = {},
): BudgetOverrideInfo {
  return {
    present: false,
    amount: 0,
    reason: "",
    actor: "",
    ...overrides,
  } as unknown as BudgetOverrideInfo;
}

function makeProtoBudget(
  overrides: Partial<{
    taskId: string;
    spent: number;
    ceiling: number;
    breakerState: string;
    override: BudgetOverrideInfo | undefined;
  }> = {},
): GetBudgetResponse {
  return {
    taskId: "task-001",
    spent: 42.5,
    ceiling: 100.0,
    breakerState: "closed",
    override: undefined,
    ...overrides,
  } as unknown as GetBudgetResponse;
}

function makeListResponse(budgets: GetBudgetResponse[]): ListBudgetsResponse {
  return { budgets } as unknown as ListBudgetsResponse;
}

// ---------------------------------------------------------------------------
// toBudgetVM — single response adapter
// ---------------------------------------------------------------------------

describe("toBudgetVM — proto GetBudgetResponse → BudgetVM adapter", () => {
  describe("scalar fields map directly", () => {
    it("maps taskId", () => {
      const vm: BudgetVM = toBudgetVM(makeProtoBudget({ taskId: "task-xyz" }));
      expect(vm.taskId).toBe("task-xyz");
    });

    it("maps spent", () => {
      const vm = toBudgetVM(makeProtoBudget({ spent: 73.25 }));
      expect(vm.spent).toBe(73.25);
    });

    it("maps ceiling", () => {
      const vm = toBudgetVM(makeProtoBudget({ ceiling: 200.0 }));
      expect(vm.ceiling).toBe(200.0);
    });

    it("maps breakerState 'closed'", () => {
      const vm = toBudgetVM(makeProtoBudget({ breakerState: "closed" }));
      expect(vm.breakerState).toBe("closed");
    });

    it("maps breakerState 'open'", () => {
      const vm = toBudgetVM(makeProtoBudget({ breakerState: "open" }));
      expect(vm.breakerState).toBe("open");
    });

    it("maps breakerState 'half-open'", () => {
      const vm = toBudgetVM(makeProtoBudget({ breakerState: "half-open" }));
      expect(vm.breakerState).toBe("half-open");
    });
  });

  describe("override — absent proto field → safe defaults", () => {
    it("override undefined → present=false", () => {
      const vm = toBudgetVM(makeProtoBudget({ override: undefined }));
      expect(vm.override.present).toBe(false);
    });

    it("override undefined → amount=0", () => {
      const vm = toBudgetVM(makeProtoBudget({ override: undefined }));
      expect(vm.override.amount).toBe(0);
    });

    it("override undefined → reason=''", () => {
      const vm = toBudgetVM(makeProtoBudget({ override: undefined }));
      expect(vm.override.reason).toBe("");
    });

    it("override undefined → actor=''", () => {
      const vm = toBudgetVM(makeProtoBudget({ override: undefined }));
      expect(vm.override.actor).toBe("");
    });
  });

  describe("override — present proto field → passthrough", () => {
    it("maps override.present=true", () => {
      const vm = toBudgetVM(
        makeProtoBudget({
          override: makeProtoOverride({ present: true, amount: 150.0, reason: "emergency", actor: "alice" }),
        }),
      );
      expect(vm.override.present).toBe(true);
    });

    it("maps override.amount when present", () => {
      const vm = toBudgetVM(
        makeProtoBudget({
          override: makeProtoOverride({ present: true, amount: 150.0, reason: "emergency", actor: "alice" }),
        }),
      );
      expect(vm.override.amount).toBe(150.0);
    });

    it("maps override.reason when present", () => {
      const vm = toBudgetVM(
        makeProtoBudget({
          override: makeProtoOverride({ present: true, amount: 150.0, reason: "emergency raise", actor: "alice" }),
        }),
      );
      expect(vm.override.reason).toBe("emergency raise");
    });

    it("maps override.actor when present", () => {
      const vm = toBudgetVM(
        makeProtoBudget({
          override: makeProtoOverride({ present: true, amount: 150.0, reason: "emergency", actor: "alice" }),
        }),
      );
      expect(vm.override.actor).toBe("alice");
    });
  });

  describe("returned value satisfies BudgetVM shape", () => {
    it("all required vm fields are present", () => {
      const vm = toBudgetVM(makeProtoBudget());
      const requiredFields: Array<keyof BudgetVM> = [
        "taskId", "spent", "ceiling", "breakerState", "override",
      ];
      for (const field of requiredFields) {
        expect(Object.prototype.hasOwnProperty.call(vm, field)).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// toBudgetsVM — list adapter for ListBudgetsResponse
// ---------------------------------------------------------------------------

describe("toBudgetsVM — ListBudgetsResponse → BudgetVM[] list adapter", () => {
  it("empty budgets list maps to empty array", () => {
    const vms = toBudgetsVM(makeListResponse([]));
    expect(vms).toHaveLength(0);
  });

  it("maps each budget in the list through toBudgetVM", () => {
    const response = makeListResponse([
      makeProtoBudget({ taskId: "task-001", spent: 10, ceiling: 100, breakerState: "closed" }),
      makeProtoBudget({ taskId: "task-002", spent: 55, ceiling: 100, breakerState: "open" }),
    ]);
    const vms = toBudgetsVM(response);
    expect(vms).toHaveLength(2);
    expect(vms[0]!.taskId).toBe("task-001");
    expect(vms[1]!.taskId).toBe("task-002");
  });

  it("preserves breakerState for each item in the list", () => {
    const response = makeListResponse([
      makeProtoBudget({ taskId: "t1", breakerState: "closed" }),
      makeProtoBudget({ taskId: "t2", breakerState: "open" }),
      makeProtoBudget({ taskId: "t3", breakerState: "half-open" }),
    ]);
    const vms = toBudgetsVM(response);
    expect(vms[0]!.breakerState).toBe("closed");
    expect(vms[1]!.breakerState).toBe("open");
    expect(vms[2]!.breakerState).toBe("half-open");
  });

  it("applies override defaults to items with absent override", () => {
    const response = makeListResponse([
      makeProtoBudget({ taskId: "t1", override: undefined }),
    ]);
    const vms = toBudgetsVM(response);
    expect(vms[0]!.override).toEqual({ present: false, amount: 0, reason: "", actor: "" });
  });
});
