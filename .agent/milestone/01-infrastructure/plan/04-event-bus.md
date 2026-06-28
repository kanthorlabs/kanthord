# 04 Event Bus (in-process)

Goal:             An in-process publish/subscribe bus so subsystems communicate
                  via events instead of direct coupling, with durable event
                  streams recorded write-before-deliver as append-only JSONL.

Decision anchors: §1 Event-driven (in-process bus; durable history = append-only
                  JSONL, not memory-only), §3 Event Bus (eventemitter3 / Emittery),
                  D5 (no external broker).

ACs:
- A subscriber receives the events it subscribed to, in **publish order**.
- **Subscriber isolation:** a subscriber that throws does not stop delivery to
  other subscribers and does not crash the publisher.
- **Unsubscribe** stops further delivery to that subscriber.
- **Durability is per event type:** an event type is declared durable or not.
  Publishing a durable event **appends it to jsonl history before the event is
  acked/delivered** (write-before-deliver) — a crash can never drop a durable
  event that callers saw as published. Non-durable types are memory-only.
- **Durable-write failure ≠ subscriber failure:** if the durable jsonl write
  fails (disk full / lock), the durable **publish fails** (caller sees the error)
  and the event is not silently delivered-but-unrecorded. A throwing *subscriber*
  is isolated (above) and never fails the publish.
- **Restart-readable:** after process restart, the durable history file is
  readable and contains the previously published durable events. **No replay onto
  the bus in v1** — the history is a write-only audit log, not a resumable queue.
- **Open event names:** publishing a new/previously-unseen event type works
  without changing the bus package. (No agent lifecycle events here — UserMessage/
  AgentStarted/ToolFinished arrive with the agent milestone; §1 lists them only as
  the illustrative flow.)

Constraints:
- In-process bus; no external broker, no Redis (D5). Pure JS, no native (D2).
- The **bus owns its delivery contract** (ordering, isolation, durable-write
  ordering); **eventemitter3 / Emittery is an impl detail** behind a thin seam, so
  swapping the lib does not change the public behavior above (§3).
- Durable history reuses the **epic-02 jsonl append** contract (one complete line
  per event, torn-line-safe) — not a second persistence path.
- Durability marking is a **typed/open event-name contract**, not a registry API
  (keep infra minimal; no plugin/registry machinery here).

Spike?:           YES (light) — read the **chosen** library's source (authoring
                  rule 4) and record a one-line finding: sync vs async dispatch,
                  ordering, and throw propagation. Required because write-before-
                  deliver ordering depends on it; library memory is not a
                  substitute for the source cite.

Verification:     `node:test` in a throwaway temp dir (never `.data/`):
                  publish→subscribe ordering; throwing-subscriber isolation;
                  unsubscribe halts delivery; durable publish appends before
                  delivery; durable-write failure fails the publish; **reopen the
                  history file and read back** the durable events.

Dependencies:     01 (workspace), 02 (jsonl append for durable history).

Findings out:     none (the library-semantics one-liner lives in the spike note,
                  not a shared findings file — no later epic needs it).
