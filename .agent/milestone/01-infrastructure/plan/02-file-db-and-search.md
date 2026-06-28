# 02 File-based DB & Search Interface

Goal:             A file-based store giving atomic, single-writer, versioned
                  reads/writes (markdown primary; json/jsonl secondary) plus a
                  swappable full-scan search interface — the persistence
                  foundation every later subsystem builds on.

Decision anchors: D1 (no SQL — build our own file DB), N1 (atomicity &
                  concurrency), N2 (query/index without SQL), B8 / §8 (`version`
                  field), §5 (storage layout), §Daemon-Modules `storage/`.

ACs:
- **Format-per-store policy ("markdown primary" with acceptance meaning):**
  human-facing records (conversations, tasks, memory) default to **markdown**
  (YAML front-matter carrying `version` + body); append-only event/audit/state
  streams are **jsonl**; purely structured machine state where markdown adds
  nothing is **json** (e.g. config — epic 03). A new store picks markdown unless
  it is an append-only stream or pure machine state.
- **Versioning:** every store file carries `version`, starting at `version: 1`.
  For markdown/json it is a top-level field; for **jsonl** the `version` is a
  file-level **header record (first line)** — appended data records do not repeat
  it. A write that would produce a versionless file fails.
- **Atomic replace:** after the writer is killed mid-write, a reader sees either
  the complete old file or the complete new file — never a partial/truncated one.
- **jsonl append (distinct contract):** appending a record is a single append of
  one complete line; a crash during append never corrupts earlier lines, and a
  torn final line is detected and skipped on read. (Atomic-replace does NOT cover
  append — it is its own guarantee.)
- **Crash model (explicit):** v1 covers **process kill and container kill
  (SIGKILL)**. OS-crash / power-loss durability (fsync of file + parent dir) is
  **out of scope for v1** — see Findings/Notes; the risk is accepted for a
  single-user local daemon.
- **Mutual exclusion:** all concurrent writers to the **same key** are serialized
  regardless of source (same-process concurrency, subprocess, or a restarted
  daemon). The file is never half-written, and after a crashed holder's lock is
  reclaimed there is **no split-brain** (two writers never proceed at once).
- **Search contract (so the swap is observable):** the interface returns records
  matching a predicate over a store, with these contract values — each record has
  a stable **key/identity**; results have a **deterministic order**; v1 has **no
  pagination** (returns all matches); a missing store yields an empty result, not
  an error. Swapping the implementation changes none of these.

Constraints:
- No SQL, no SQLite, no ORM — file primitives only (D1).
- Atomic replace = write-temp-then-`rename()` within the **same directory /
  filesystem** as the target (N1); a cross-filesystem rename silently copies and
  is not atomic — keep the temp beside the target.
- jsonl append = one `O_APPEND` write of a complete line (not write-temp-rename).
- Single-writer process model **plus** a file-based lock taken before every
  read-modify-write and released in `finally` (N1, D5); reclaimable after a
  crashed holder with **no split-brain**. Lock primitive is file-based, no native
  dep (D2) — mechanism (`O_EXCL`/mkdir/etc.) is the engineer's choice.
- Search/index is a custom interface; the only v1 impl is **full-scan** — add
  index strategies only at a real performance wall (N2). No external search
  engine. (Full-scan is the mechanism; the AC above is the behavior.)
- `version` exists and is read back here (B8, §8); actual migration logic is out
  of scope (epic 14) — epic 02 only guarantees the field is present and preserved.

Spike?:           YES — fs atomicity + lock semantics (authoring rule 3). Confirm
                  on **both** macOS-native and inside the Podman `.data/` mount
                  (virtiofs): (a) `rename()` atomically replaces the target;
                  (b) a torn write leaves the old file intact; (c) `O_APPEND`
                  line writes do not interleave/tear under concurrency; (d) the
                  chosen lock gives mutual exclusion and is reclaimed after a kill
                  with no split-brain. Overlaps the dev-setup mount check.

Verification:     `node:test` units in a throwaway temp dir (never `.data/`):
                  atomic-replace, jsonl append + torn-line skip, lock mutual-
                  exclusion + reclaim, `version` round-trip (md/json/jsonl-header),
                  full-scan search (key/order/empty-store). **The same primitive
                  tests must also pass inside the container** (the virtiofs path is
                  the known risk — a host-only pass is not the done-gate). The
                  recorded spike does NOT close the task; the passing tests do
                  (rule 8).

Dependencies:     01 (workspace + a package home). dev-setup
                  (`02-development-setup.md`) for the `.data/` mount — the
                  container leg of the spike/tests runs there.

Findings out:     `.agent/milestone/01-infrastructure/plan/findings/02-filedb-atomicity.md`
                  — confirmed atomic-rename + append + lock/reclaim behavior on
                  macOS-native vs the Podman mount, and the recorded v1 crash-model
                  / fsync scope decision. Epics 05 (logging jsonl), 06 (scheduler
                  job store), 08 (auth files), 14 (migrations) build on these
                  primitives and need the confirmed semantics.
