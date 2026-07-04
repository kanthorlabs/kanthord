import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PROJECTION_CONTRACT_VERSION, PROJECTION_CONTRACT, projectionOf } from "./projection.ts";

describe("src/store/projection", () => {
  // -------------------------------------------------------------------------
  // (a) PROJECTION_CONTRACT_VERSION fixed value
  // -------------------------------------------------------------------------
  test("PROJECTION_CONTRACT_VERSION is '1'", () => {
    assert.equal(PROJECTION_CONTRACT_VERSION, "1");
  });

  // -------------------------------------------------------------------------
  // (b) compiled-plan columns + node_status classified markdown-derived
  // -------------------------------------------------------------------------
  test("plan_node columns are classified markdown-derived with a named source", () => {
    const planNode = PROJECTION_CONTRACT.tables["plan_node"];
    assert.ok(planNode !== undefined, "plan_node table entry exists in contract");
    const cols = planNode.columns;

    const id = cols["id"];
    assert.ok(id !== undefined && "derived" in id, "plan_node.id is markdown-derived");
    assert.ok(
      typeof (id as { derived: string }).derived === "string" &&
        (id as { derived: string }).derived.length > 0,
      "plan_node.id has a non-empty named source",
    );

    const kind = cols["kind"];
    assert.ok(kind !== undefined && "derived" in kind, "plan_node.kind is markdown-derived");

    const featureId = cols["feature_id"];
    assert.ok(
      featureId !== undefined && "derived" in featureId,
      "plan_node.feature_id is markdown-derived",
    );
  });

  test("node_status field is classified markdown-derived (write-through invariant)", () => {
    const ns = PROJECTION_CONTRACT.nodeStatus;
    assert.ok(ns !== undefined, "nodeStatus entry exists in contract");
    assert.ok("derived" in ns, "node_status is markdown-derived");
    assert.ok(
      typeof ns.derived === "string" && ns.derived.length > 0,
      "node_status has a non-empty named source",
    );
  });

  // -------------------------------------------------------------------------
  // (c) runtime-only set: leases, poll cursors, op_id → request_id
  // -------------------------------------------------------------------------
  test("leases, poll cursors, and op_id are classified runtime-only", () => {
    const ro = PROJECTION_CONTRACT.runtimeOnly;
    assert.ok(Array.isArray(ro), "runtimeOnly is an array");
    assert.ok(ro.includes("lease_holder"), "lease_holder is in the runtime-only set");
    assert.ok(ro.includes("poll_cursor"), "poll_cursor is in the runtime-only set");
    assert.ok(ro.includes("op_id"), "op_id is in the runtime-only set");
  });

  // -------------------------------------------------------------------------
  // (d) row-identity keys and table scope
  // -------------------------------------------------------------------------
  test("contract declares row-identity keys per compiled-plan table", () => {
    const planNode = PROJECTION_CONTRACT.tables["plan_node"];
    assert.ok(planNode !== undefined, "plan_node entry exists");
    assert.deepEqual(planNode.rowIdentityKey, ["id"]);

    const planEdge = PROJECTION_CONTRACT.tables["plan_edge"];
    assert.ok(planEdge !== undefined, "plan_edge entry exists");
    assert.deepEqual(planEdge.rowIdentityKey, ["from_node_id", "to_node_id", "kind"]);
  });

  test("contract declares tableScope listing covered compiled-plan tables", () => {
    const scope = PROJECTION_CONTRACT.tableScope;
    assert.ok(Array.isArray(scope), "tableScope is an array");
    assert.ok(scope.includes("plan_node"), "plan_node in tableScope");
    assert.ok(scope.includes("plan_edge"), "plan_edge in tableScope");
    assert.ok(scope.includes("plan_gate"), "plan_gate in tableScope");
    assert.ok(scope.includes("plan_artifact"), "plan_artifact in tableScope");
    assert.ok(scope.includes("plan_generation"), "plan_generation in tableScope");
  });

  // -------------------------------------------------------------------------
  // (e) no op_ledger in v1 (future section only)
  // -------------------------------------------------------------------------
  test("op_ledger is absent from the v1 contract (documented as future section)", () => {
    assert.ok(
      !("op_ledger" in PROJECTION_CONTRACT.tables),
      "op_ledger must NOT appear in v1 contract tables",
    );
  });

  // -------------------------------------------------------------------------
  // (B1) plan_artifact_consumer and plan_deploy_stage must be in the contract
  // -------------------------------------------------------------------------
  test("plan_artifact_consumer is in tableScope with rowIdentityKey [\"artifact_id\",\"consumer_node_id\"] and all columns derived", () => {
    const scope = PROJECTION_CONTRACT.tableScope;
    assert.ok(scope.includes("plan_artifact_consumer"), "plan_artifact_consumer in tableScope");
    const entry = PROJECTION_CONTRACT.tables["plan_artifact_consumer"];
    assert.ok(entry !== undefined, "plan_artifact_consumer entry exists in contract tables");
    assert.deepEqual(entry.rowIdentityKey, ["artifact_id", "consumer_node_id"]);
    const artifactId = entry.columns["artifact_id"];
    assert.ok(
      artifactId !== undefined && "derived" in artifactId,
      "plan_artifact_consumer.artifact_id is markdown-derived",
    );
    const consumerNodeId = entry.columns["consumer_node_id"];
    assert.ok(
      consumerNodeId !== undefined && "derived" in consumerNodeId,
      "plan_artifact_consumer.consumer_node_id is markdown-derived",
    );
  });

  test("plan_deploy_stage is in tableScope with rowIdentityKey [\"node_id\"] and all columns derived", () => {
    const scope = PROJECTION_CONTRACT.tableScope;
    assert.ok(scope.includes("plan_deploy_stage"), "plan_deploy_stage in tableScope");
    const entry = PROJECTION_CONTRACT.tables["plan_deploy_stage"];
    assert.ok(entry !== undefined, "plan_deploy_stage entry exists in contract tables");
    assert.deepEqual(entry.rowIdentityKey, ["node_id"]);
    const nodeId = entry.columns["node_id"];
    assert.ok(
      nodeId !== undefined && "derived" in nodeId,
      "plan_deploy_stage.node_id is markdown-derived",
    );
  });

  // -------------------------------------------------------------------------
  // (f) projectionOf — runtime-only fields stripped; derived fields kept
  // -------------------------------------------------------------------------
  test("projectionOf: rows differing only in lease_holder (runtime-only) project equal", () => {
    const rowA = { id: "e1.s1.t1", kind: "task", feature_id: "e1", lease_holder: "daemon-a" };
    const rowB = { id: "e1.s1.t1", kind: "task", feature_id: "e1", lease_holder: "daemon-b" };
    assert.deepEqual(projectionOf(rowA), projectionOf(rowB));
  });

  test("projectionOf: rows differing in markdown-derived field (node status) project unequal", () => {
    const rowA = { id: "e1.s1.t1", kind: "task", feature_id: "e1", status: "open" };
    const rowB = { id: "e1.s1.t1", kind: "task", feature_id: "e1", status: "in_progress" };
    assert.notDeepEqual(projectionOf(rowA), projectionOf(rowB));
  });
});
