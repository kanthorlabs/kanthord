# Shared helpers. Source this file. Do not run it.

set -u

ROOT=${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
ENGINE_DIR="$ROOT/engine"
APP_DIR="$ROOT/apps"
RUN_DIR="$ROOT/.dev"
WORKTREE_DIR="$ROOT/.worktree"

ENGINE_PORT=${ENGINE_PORT:-31415}
WEB_PORT=${WEB_PORT:-27182}

SUBMODULES="engine apps"

log() { printf '%s: %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2; }
die() { warn "$*"; exit 1; }

# repo_dir <engine|apps|parent> -> absolute path
repo_dir() {
	case "$1" in
	engine) printf '%s' "$ENGINE_DIR" ;;
	apps) printf '%s' "$APP_DIR" ;;
	parent | .) printf '%s' "$ROOT" ;;
	*) die "unknown repository $1" ;;
	esac
}

# Ask a yes/no question. YES=1 answers yes. No terminal answers no.
confirm() {
	if [ "${YES:-0}" = "1" ]; then
		log "$1 -> yes (YES=1)"
		return 0
	fi
	if [ ! -t 0 ]; then
		warn "$1 -> no terminal, and no policy. Refused"
		return 1
	fi
	printf '%s: %s [y/N] ' "$SCRIPT_NAME" "$1" >&2
	read -r answer
	case "$answer" in [yY] | [yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# Choose one of several answers. The named variable pre-answers it.
choose() {
	prompt=$1
	shift
	printf '%s: %s\n' "$SCRIPT_NAME" "$prompt" >&2
	index=1
	for option in "$@"; do
		printf '  %d) %s\n' "$index" "$option" >&2
		index=$((index + 1))
	done
	if [ ! -t 0 ]; then
		warn "no terminal, and no policy. Refused"
		return 1
	fi
	printf '%s: choose [1-%d] ' "$SCRIPT_NAME" "$#" >&2
	read -r answer
	printf '%s' "$answer"
}

# A submodule and a linked worktree keep .git as a file, so a literal
# .git/<name> test is wrong. Ask git for the real path.
git_path() { git -C "$1" rev-parse --git-path "$2"; }

# Report an unfinished git operation, or nothing.
in_progress() {
	dir=$1
	for marker in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do
		if [ -e "$(git_path "$dir" "$marker")" ]; then
			printf '%s' "$marker"
			return 0
		fi
	done
	return 1
}

# Report unmerged index entries, or nothing.
has_unmerged() { [ -n "$(git -C "$1" diff --name-only --diff-filter=U)" ]; }

# Tracked modifications only. Untracked files are reported separately.
is_dirty() { [ -n "$(git -C "$1" status --porcelain --untracked-files=no --ignore-submodules=all)" ]; }

untracked_files() { git -C "$1" ls-files --others --exclude-standard; }

current_branch() { git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null || true; }

require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed"; }

# owner/name from a remote url. The ssh host is an alias, so the path is used.
repo_slug() {
	url=$(git -C "$1" remote get-url origin 2>/dev/null) || return 1
	url=${url%.git}
	url=${url##*:}
	printf '%s' "${url#*//*/}"
}

# Count the pull requests opened for a branch. Prints a number, or nothing.
pr_count() {
	command -v gh >/dev/null || return 1
	slug=$(repo_slug "$1") || return 1
	gh pr list --repo "$slug" --head "$2" --state all --json number --jq 'length' 2>/dev/null
}
