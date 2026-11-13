import assert from "node:assert/strict";
import test from "node:test";
import { pollInboundBody } from "./inbound.mjs";

const repository = {
  github: "owner/name",
  config: { credential: "github-token" },
};

test("the poll inbound body holds the resource kind repository", () => {
  const body = pollInboundBody({ projectId: "project-1", repository });
  assert.deepEqual(body.configuration, {
    resource_kind: "repository",
    resource: "owner/name",
  });
});

test("the poll inbound body names the project, the credential and the consumer", () => {
  const body = pollInboundBody({ projectId: "project-1", repository });
  assert.equal(body.project_id, "project-1");
  assert.equal(body.kind, "poll");
  assert.equal(body.platform, "github");
  assert.equal(body.consumer, "mission.delivery.admit");
  assert.equal(body.credential, "github-token");
});
