#!/usr/bin/env bash
# memory-append-only.sh — reject staged deletions under .agent/tdd/memory/.
#
# The TDD memory journals are append-only by contract: an agent adds today's entries
# after the existing ones. A full-file rewrite silently drops prior-epic decisions.
# This has happened at least twice (008.2, then again in 008.3 — the second time the
# deleted text itself contained the record of the first fix), so it is enforced here
# rather than trusted to instructions.
#
# Passes when a memory file is added, or changed with additions only. Fails when a
# staged change deletes or replaces any existing line. Escape hatch for a deliberate
# rewrite (rare — prefer a new file): ALLOW_MEMORY_REWRITE=1 git commit …
set -uo pipefail

MEM_PATH=".agent/tdd/memory/"

if [ "${ALLOW_MEMORY_REWRITE:-0}" = "1" ]; then
  exit 0
fi

# --diff-filter=M: only MODIFIED files can lose lines; A/D/R are not rewrites-in-place.
# --numstat prints "<added>\t<deleted>\t<path>"; deleted > 0 on a modified memory file
# means existing content was removed.
offenders=$(
  git diff --cached --numstat --diff-filter=M -- "$MEM_PATH" |
    awk -F'\t' '$2 != "0" && $2 != "-" { printf "  %s (%s added, %s deleted)\n", $3, $1, $2 }'
)

if [ -n "$offenders" ]; then
  {
    echo "BLOCKED: TDD memory files are append-only, but this commit deletes lines:"
    echo "$offenders"
    echo
    echo "Restore the prior content and APPEND the new entries after it:"
    echo "  git show HEAD:<path> > /tmp/mem-restore.md"
    echo "  # then re-create the file as: prior content + your new entries"
    echo
    echo "If the rewrite is genuinely intended: ALLOW_MEMORY_REWRITE=1 git commit ..."
  } >&2
  exit 1
fi

exit 0
