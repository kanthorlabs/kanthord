// src/app/project/ack-project.ts — `AckProject` use case (016 Story 5).
//
// Pure use case. Five pinned rules, checked in this exact order:
//   1. unknown project  → `UnknownReferenceError("project", id)`
//   2. non-ULID cursor  → `CursorNotUlidError` (rejected BEFORE feed check)
//   3. cursor > latest  → `CursorAheadOfFeedError` (latest === null when the
//      project has no events — there is nothing to acknowledge)
//   4. cursor <= stored → silent no-op (monotonic; never an error)
//   5. otherwise        → `setAck(projectId, cursor)` exactly once
//
// `AckProject` is the only writer of `project_acks` (Story 5 Constraints).

import { UnknownReferenceError } from "../errors.ts";
import type { Project } from "../../domain/project.ts";

/** The cursor failed Crockford base32 length-26 validation. */
export class CursorNotUlidError extends Error {
  readonly cursor: string;

  constructor(cursor: string) {
    super(`cursor is not a ULID: ${cursor}`);
    this.name = "CursorNotUlidError";
    this.cursor = cursor;
  }
}

/** The cursor is greater than the project's latest event id, or no events exist. */
export class CursorAheadOfFeedError extends Error {
  readonly cursor: string;
  readonly latest: string | null;

  constructor(cursor: string, latest: string | null) {
    super(
      `cursor ${cursor} is ahead of the project feed (latest: ${
        latest ?? "none"
      })`,
    );
    this.name = "CursorAheadOfFeedError";
    this.cursor = cursor;
    this.latest = latest;
  }
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

interface AckSource {
  getAck(projectId: string): string | undefined;
  setAck(projectId: string, cursor: string): void;
  latestProjectEventId(projectId: string): string | undefined;
}

interface ProjectsSource {
  get(id: string): Project | undefined;
}

export class AckProject {
  readonly #acks: AckSource;
  readonly #projects: ProjectsSource;

  constructor(acks: AckSource, projects: ProjectsSource) {
    this.#acks = acks;
    this.#projects = projects;
  }

  async execute(input: {
    projectId: string;
    cursor: string;
  }): Promise<{ cursor: string }> {
    // Rule 1: unknown project
    if (this.#projects.get(input.projectId) === undefined) {
      throw new UnknownReferenceError("project", input.projectId);
    }

    // Rule 2: cursor must be a 26-char uppercase Crockford ULID
    if (!ULID_RE.test(input.cursor)) {
      throw new CursorNotUlidError(input.cursor);
    }

    // Rule 3: not ahead of the project feed (ULIDs sort lexicographically by time)
    const latest = this.#acks.latestProjectEventId(input.projectId);
    if (latest === undefined || input.cursor > latest) {
      throw new CursorAheadOfFeedError(input.cursor, latest ?? null);
    }

    // Rule 4: monotonic — backwards or repeat ack is a silent no-op. The
    // cursor now in effect is the one already stored, never the rejected input.
    const stored = this.#acks.getAck(input.projectId);
    if (stored !== undefined && input.cursor <= stored) {
      return { cursor: stored };
    }

    // Rule 5: forward ack — the cursor now in effect is the new one.
    this.#acks.setAck(input.projectId, input.cursor);
    return { cursor: input.cursor };
  }
}
