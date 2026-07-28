// src/apps/cli/setup/prompt.ts — EPIC 015 Story 5
// The interactive-prompt seam the guided setup wizard injects. A single
// one-method interface so the hermetic test bundle can fake it with an
// array of queued answers, and the real `composition.ts` can implement it
// over `node:readline` (the same block already used by `login`).
//
// Why a separate type and not a member of `CliIo` (`src/apps/cli/commands/action.ts:7-11`):
// `CliIo` is output-only, and every `noopIo` / `capture()` literal in the
// suite would stop type-checking. `SetupPrompt` follows the same precedent
// as `LoginIO` (`src/apps/cli/login.ts:6-19`) — a small capability port
// wired from the composition root.

/**
 * The minimal interactive-prompt surface the setup wizard needs. The
 * wizard never prompts for a secret — only for a key's *path* or value —
 * so the interface stays a single method.
 *
 * `undefined` is the abort signal: EOF (readline closes without a line)
 * or Ctrl-C (the readline interface receives the close event). The wizard
 * treats either as a user-initiated abort, returns `exitCode: 1` with
 * `error: aborted`, and never writes to the database.
 */
export interface SetupPrompt {
  /**
   * Display `message` and return the user's answer. Resolves `undefined`
   * on EOF / Ctrl-C so the wizard can abort cleanly.
   */
  ask(message: string): Promise<string | undefined>;
}
