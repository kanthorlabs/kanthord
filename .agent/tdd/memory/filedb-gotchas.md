# File-based store gotchas (read before touching persistence)

Living checklist. Append a dated bullet when a new pitfall bites.

- **`version` field is mandatory.** Every persisted file (markdown primary,
  json/jsonl secondary) carries a `version` field. A write without it is a
  review BLOCKER.
- **Atomic write = write-temp-then-rename, same filesystem.** Write to a temp
  file in the *same directory* as the target, then `rename()`. A rename across
  filesystems is not atomic and will silently copy — keep the temp beside the
  target.
- **Single-writer + file lock (N1).** Acquire the lock before read-modify-write,
  release it in a `finally`. A dropped or never-released lock is a BLOCKER.
- **No SQL / SQLite / ORM.** Build on the file primitives only.
- **Tests use a throwaway temp dir.** A test that touches the store must create
  its own temp dir and remove it; never write into `.data/`.
