---
title: Mission Service Implementation
---

# Mission Service Implementation

This file holds the implementation rulings for the mechanisms that realize [mission-service.md](mission-service.md).
This file is not a design document, and `mission-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.

## The identities of the Mission Service

The identities follow the identity convention of [architecture.impl.md](architecture.impl.md#the-identity-and-the-time).

- A node uses `node_<ulid>`.
- An evidence record uses `evidence_<ulid>`.
- An evaluation uses `evaluation_<ulid>`.
- An assessment uses `assessment_<ulid>`.
- An outcome uses `outcome_<ulid>`.
- An external object uses `external_object_<ulid>`.
- An observation uses `observation_<ulid>`.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) declares `mission_<ulid>` and `request_<ulid>`.
- A mission change uses its mission revision as its key within the mission.
- An attempt uses its attempt number as its key within the node. Neither an attempt nor a mission change takes a prefix.
- The Scheduler Service declares the execution identity.

## The revisions

- Every revision and version counter of the server starts at 1.
- Every `version`, `revision` and `expected*Revision` field holds a positive safe integer.
- A count is no revision. The attempt counter starts at 0.
- `gateway.tokenGeneration` keeps its default of 1.
- A mission starts at mission revision 1, and a node starts at node revision 1.
- A node takes its next node revision on every content change.
- These writes increment the mission revision when they change the structure of the mission or the content of a node:
  - import apply
  - node create
  - node update
  - node retire
  - node move
  - dependency add
  - dependency remove
  - criterion set
  - an unblock that carries a change
- These writes leave the mission revision unchanged:
  - priority
  - pause
  - resume
  - block
  - discard
  - mark-ready
  - attempt
  - evidence
  - run output
  - outcome
  - observation
- One write increments once, however many nodes it touches.
- A write with no structure or content change leaves the mission revision unchanged.

## The mission change

- The table is `mission_change(mission_id, mission_revision, actor, reason, created_at, result)`.
- Its primary key is `(mission_id, mission_revision)`.
- The write that increments the mission revision inserts the row in its own transaction.
- `result` holds the node revisions created, the retired node identities, and the edges added and removed.
- `result` uses the canonical JSON of [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- The Mission Service keeps every mission change for the life of the mission. No sweep deletes a row.
- `change list` pages by the shared descending rule of [architecture.impl.md](architecture.impl.md#pagination).
- `change list` and `change get` use the `human` access policy.
- The `NodeChange` answer of a graph write is the stored result of its mission change.

## Operation contracts

- Every Mission route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging) of the Gateway Service.
- Every Mission route uses the [default 30 s timeout](gateway-service.impl.md#cancellation).
- Every Mission route uses the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits).
- A stale expected revision or mission revision answers 409 `mission.revision_conflict` with the current value in `details`.
- An absent node, mission or record answers 404 `mission.not_found`.
- `graph get` answers at most 10 MiB. A larger graph answers 413 `mission.graph.too_large`.
- That error holds the node count and the paged reads `node list` and `edge list` in `details`.

## Tests

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that every revision and version counter starts at 1 and every such field requires a positive safe integer.
- A test asserts that the attempt counter starts at 0 and the default of `gateway.tokenGeneration` stays 1.
- A test asserts one mission revision increment for each graph write, even when the write touches several nodes.
- A test asserts no mission revision increment for each non-graph write and for a write with no structure or content change.
- A test asserts that each content change creates the next node revision.
- A test asserts that the mission change row and its write commit or roll back together.
- A test checks the canonical result, its `NodeChange` answer and its retention for the life of the mission.
- A test asserts that no sweep deletes a mission change row.
- A test checks `change list` and `change get`, the `human` policy and the shared page order.
- A test checks the shared error envelope, the 30 s timeout and the 10 MiB body limit on every Mission route.
- A test asserts 409 `mission.revision_conflict` with the current value for a stale expected revision or mission revision.
- A test asserts 404 `mission.not_found` for an absent node, mission or record.
- A test checks `graph get` at 10 MiB and above that bound.
- It asserts 413 `mission.graph.too_large` above the bound, with the node count and both paged reads in `details`.
