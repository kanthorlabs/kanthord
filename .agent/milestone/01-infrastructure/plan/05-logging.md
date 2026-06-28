# 05 Logging (pino, operational)

Goal:             Structured operational logging via pino to rotating jsonl files,
                  kept strictly separate from audit/events/state — so operations
                  are observable without polluting the durable record.

Decision anchors: §3 Logging (pino, structured; operational → rotating jsonl
                  files), B6 (operational logs split from audit/events/state —
                  never mixed), D5 (file-based, in-process — no external shipper),
                  D2 (no native modules), §5 (`logs/` dir).

ACs:
- Operational logs are written as structured **jsonl** (one object per line, with
  at least level + timestamp + message) to files under the `logs/` dir.
- Operational log files **rotate** by size and/or age; the default retention keeps
  the **last 7 rotated files** (config-overridable), so logs do not grow
  unbounded.
- **Split, by destination (B6):** operational log records land **only in
  `logs/`**; audit/events/state records land **only in `database/`** via their
  owners (epics 02/04). A test writes one of each and asserts each lands in its
  own directory and not the other.
- The operational log **level is set from config** (epic 03); an invalid level is
  caught by config validation, not silently ignored.

Constraints:
- Operational logging uses **pino**, structured (§3); pino is **operational-only**
  — the audit/events/state side is owned by epics 02/04, and the operational
  logger has no write path into `database/` (B6).
- Rotation is **file-based, in-process, no external shipper/cron** (D5), writing
  within `logs/`.
- pino and the chosen rotation must be **pure JS, no native `.node`** (D2); they
  pass the epic-03 native-modules guard.
- Crash-durable operational logging (flush-on-exit / sync transport) is **not**
  required — no decision mandates it; operational logs are best-effort.
- Secret redaction in operational logs is **not an epic-05 AC** (no secrets flow
  yet); when auth + provider keys land (epic 08), that epic ensures they are
  redacted from operational logs (B4/B10).

Spike?:           light — confirm (authoring rule 4) that pino + the chosen
                  rotation are pure-JS (no native transport dep) and that rotation
                  behaves on the Podman `.data/logs` mount. Reuse epic-02 mount
                  findings; skip if those cover it and the rotation lib is known
                  pure-JS.

Verification:     `node:test` / harness in a throwaway temp dir (never `.data/`):
                  an operational line is valid jsonl with level/ts/msg; crossing
                  the size/age threshold yields a new file and keeps at most 7;
                  level honored from config; a write-one-of-each test confirms the
                  `logs/` vs `database/` destination split.

Dependencies:     01 (workspace), 03 (log level from config). The audit/state
                  destination is epics 02/04 (referenced for the split, not built
                  here).

Findings out:     none.
