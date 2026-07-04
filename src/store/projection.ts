/**
 * Versioned Projection Contract — Epic 003, Story 002
 *
 * Classifies every compiled-plan SQLite column as either:
 *   - markdown-derived: { derived: "<named source>" }
 *     The daemon updates the value by writing to markdown; the SQLite projection
 *     follows. Rebuilding from markdown must reproduce these fields exactly.
 *   - runtime-only: { runtimeOnly: true }
 *     No markdown source; held only in SQLite. Excluded from rebuild equality checks.
 *
 * Node-status write-through invariant:
 *   The daemon updates a task's status by writing frontmatter (single-writer);
 *   the SQLite `node_status` value is therefore markdown-derived, never mutated
 *   in SQLite independently. If that invariant were violated, the contract would lie.
 *
 * Operation-ledger (v2):
 *   Epic 005 Story 006 adds the op_ledger table to this contract.
 *   All six §5 ledger-identity fields are markdown-derived; request_id is
 *   runtime-only (ephemeral SQLite mapping, never synced to markdown).
 *
 * Comparison rules:
 *   - Rows are compared order-independently within each table.
 *   - Row identity is determined by the table's rowIdentityKey (composite PK).
 *   - Only markdown-derived columns participate in equality; runtime-only
 *     columns are stripped by projectionOf() before comparison.
 *   - The "semantics" column in plan_edge and plan_gate is a canonical JSON
 *     string (already a TEXT in SQLite); no further canonicalisation needed.
 */

// ---------------------------------------------------------------------------
// Column classification types
// ---------------------------------------------------------------------------

export type DerivedColumn = { derived: string };
export type RuntimeOnlyColumn = { runtimeOnly: true };
export type ColumnClassification = DerivedColumn | RuntimeOnlyColumn;

// ---------------------------------------------------------------------------
// Table entry type
// ---------------------------------------------------------------------------

export type TableEntry = {
  /** Columns that together uniquely identify a row. */
  rowIdentityKey: string[];
  /** Per-column classification. */
  columns: Record<string, ColumnClassification>;
};

// ---------------------------------------------------------------------------
// Top-level contract type
// ---------------------------------------------------------------------------

export type ProjectionContract = {
  /**
   * The tables covered by this projection contract.
   * Includes op_ledger from v2 onward.
   */
  tableScope: string[];

  /**
   * Per-table entry: row identity key + per-column classification.
   * op_ledger is present from v2 onward.
   */
  tables: Record<string, TableEntry>;

  /**
   * Node status is markdown-derived: the daemon writes status by updating
   * frontmatter (write-through invariant). Stored in a separate node_status
   * table (Phase 2); documented here so rebuild and verify know it is in scope.
   */
  nodeStatus: DerivedColumn;

  /**
   * Runtime-only field names (cross-table list). These fields have no markdown
   * source and MUST be excluded from projection equality checks.
   * Includes at minimum: lease_holder, poll_cursor, request_id.
   */
  runtimeOnly: string[];
};

// ---------------------------------------------------------------------------
// PROJECTION_CONTRACT_VERSION
// ---------------------------------------------------------------------------

/**
 * Bumped to "2" by Epic 005 Story 006: adds the op_ledger section and promotes
 * op_id from a cross-table runtime sentinel to a markdown-derived ledger field.
 */
export const PROJECTION_CONTRACT_VERSION: string = "2";

// ---------------------------------------------------------------------------
// PROJECTION_CONTRACT
// ---------------------------------------------------------------------------

export const PROJECTION_CONTRACT: ProjectionContract = {
  // -------------------------------------------------------------------------
  // Table scope (seven compiled-plan tables in v1)
  // -------------------------------------------------------------------------
  tableScope: [
    "plan_node",
    "plan_edge",
    "plan_gate",
    "plan_artifact",
    "plan_artifact_consumer",
    "plan_deploy_stage",
    "plan_generation",
    "op_ledger",
  ],

  // -------------------------------------------------------------------------
  // Per-table entries
  // -------------------------------------------------------------------------
  tables: {
    plan_node: {
      rowIdentityKey: ["id"],
      columns: {
        id: {
          derived: "epic/task frontmatter id field",
        },
        kind: {
          derived:
            "file type: epic.md → epic; story directory → story; task file → task; deploy_chain entry → deploy-stage",
        },
        feature_id: {
          derived: "epic frontmatter id field (all nodes inherit the feature id)",
        },
        repo: {
          derived: "frontmatter repo field (null when absent)",
        },
        ticket_system: {
          derived: "frontmatter ticket_system field (null when absent)",
        },
        ticket_ref: {
          derived: "frontmatter ticket field (null when absent)",
        },
        major: {
          derived:
            "leading major number parsed from story/task filename (null for epic and deploy-stage nodes)",
        },
        lane: {
          derived:
            "lane number parsed from story filename (null when absent or for non-story nodes)",
        },
        slug: {
          derived:
            "slug segment from filename or frontmatter id (null for epic nodes)",
        },
        // Runtime-only: the generation counter is assigned by compile() at
        // write time and incremented per compile run; it has no markdown source.
        generation: { runtimeOnly: true },
        // Runtime-only: populated by an optional sourceProvider at compile
        // time; not derivable from markdown content alone.
        content_hash: { runtimeOnly: true },
        snapshot_at: { runtimeOnly: true },
      },
    },

    plan_edge: {
      rowIdentityKey: ["from_node_id", "to_node_id", "kind"],
      columns: {
        from_node_id: {
          derived:
            "source node id — derived from grammar chain rules or depends_on edges in frontmatter",
        },
        to_node_id: {
          derived:
            "target node id — derived from grammar chain rules or depends_on edges in frontmatter",
        },
        kind: {
          derived:
            "edge type: grammar (sequential chain) or handoff (explicit depends_on in frontmatter)",
        },
        semantics: {
          derived:
            "depends_on[].semantics field (frozen | draft_ok); null for grammar edges",
        },
      },
    },

    plan_gate: {
      rowIdentityKey: ["node_id", "phase", "position", "name"],
      columns: {
        node_id: {
          derived: "owning task or epic node id",
        },
        phase: {
          derived:
            "gate phase: 0 = prerequisites (## Prerequisites section), 1 = TDD gate (## Tests section) or feature acceptance",
        },
        position: {
          derived: "entry or exit — determined by gate kind (entry = prerequisite/failing-test, exit = tests-pass/feature-accepted)",
        },
        name: {
          derived:
            "gate name from tdd@1 vocabulary (failing_test_exists, tests_pass, prerequisites_satisfied, feature_accepted) or consumes:<artifact_id>",
        },
        artifact_id: {
          derived:
            "depends_on[].output artifact id; null for non-consumption gates",
        },
        semantics: {
          derived:
            "depends_on[].semantics for consumption gates (frozen | draft_ok); null otherwise",
        },
      },
    },

    plan_artifact: {
      rowIdentityKey: ["id"],
      columns: {
        id: {
          derived: "frontmatter artifacts_out[].id",
        },
        publisher_node_id: {
          derived: "id of the task that declares the artifact in artifacts_out",
        },
        kind: {
          derived: "frontmatter artifacts_out[].kind",
        },
        path: {
          derived: "frontmatter artifacts_out[].path",
        },
      },
    },

    plan_artifact_consumer: {
      rowIdentityKey: ["artifact_id", "consumer_node_id"],
      columns: {
        artifact_id: {
          derived: "depends_on[].output artifact id — the artifact consumed by this task",
        },
        consumer_node_id: {
          derived: "id of the task node that declares the depends_on entry",
        },
      },
    },

    plan_deploy_stage: {
      rowIdentityKey: ["node_id"],
      columns: {
        node_id: {
          derived: "epic frontmatter id + deploy_chain[].stage concatenated as <feature_id>-deploy-<stage>",
        },
        handlers: {
          derived: "JSON serialisation of deploy_chain[].handlers array from epic frontmatter",
        },
        success_criteria: {
          derived: "deploy_chain[].success_criteria field from epic frontmatter",
        },
        soak_duration: {
          derived: "deploy_chain[].soak_duration field from epic frontmatter",
        },
      },
    },

    plan_generation: {
      rowIdentityKey: ["generation", "feature_id"],
      columns: {
        // Runtime-only: a monotonically incrementing counter assigned by compile().
        generation: { runtimeOnly: true },
        compile_hash: {
          derived:
            "SHA-256 of covered markdown files (epic.md with compile: key stripped, INDEX.md, story task files); excludes RUNBOOK.md, *.state.md, *.journal.jsonl",
        },
        feature_id: {
          derived: "epic frontmatter id field",
        },
        // Runtime-only: the wall-clock timestamp at which compile() ran.
        at: { runtimeOnly: true },
      },
    },

    op_ledger: {
      rowIdentityKey: ["op_id"],
      columns: {
        op_id: {
          derived: "generated UUID written into task markdown on first submit; stable across crash/restart",
        },
        verb: {
          derived: "verb name from the verb registry YAML entry that created this operation",
        },
        idempotency_key: {
          derived: "caller-supplied idempotency key on submit; preserved in task markdown for dedup and reconcile",
        },
        correlation: {
          derived: "external correlation id from adapter submit result; written into task markdown for reconcile",
        },
        desired_effect_hash: {
          derived: "SHA-256 of the desired-effect payload written into task markdown; used by reconcile to verify observed state",
        },
        status: {
          derived: "op lifecycle status written into task markdown: pending | in_flight | done | failed | expired | needs_reconciliation",
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Node-status write-through invariant
  // -------------------------------------------------------------------------
  nodeStatus: {
    derived:
      "task frontmatter status field — daemon writes status by updating frontmatter (single-writer invariant); SQLite node_status follows the write",
  },

  // -------------------------------------------------------------------------
  // Cross-table runtime-only fields (excluded from all projection comparisons)
  // -------------------------------------------------------------------------
  runtimeOnly: [
    "lease_holder", // which daemon instance holds the current lease on a node
    "poll_cursor", // position in the event stream; reset on restart
    "request_id", // ephemeral broker request_id (op_id → request_id mapping); never synced to markdown
    "generation", // compile run counter (plan_node, plan_generation)
    "content_hash", // snapshot from sourceProvider; not in markdown
    "snapshot_at", // snapshot timestamp; not in markdown
    "at", // plan_generation compile timestamp
  ],
};

// ---------------------------------------------------------------------------
// Module-level runtime-only set — constructed once, reused by projectionOf
// ---------------------------------------------------------------------------

/**
 * Frozen set of cross-table runtime-only field names, constructed once at
 * module load time (not per-call) so repeated calls to `projectionOf` and
 * `diffProjection` do not allocate a new Set per row.  Behavior is identical
 * to allocating inline; the source of truth remains `PROJECTION_CONTRACT.runtimeOnly`.
 */
export const RUNTIME_ONLY_SET: ReadonlySet<string> = new Set(PROJECTION_CONTRACT.runtimeOnly);

// ---------------------------------------------------------------------------
// projectionOf — strip runtime-only fields from a row
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `row` with every key in `PROJECTION_CONTRACT.runtimeOnly`
 * removed. Uses the cross-table runtimeOnly list as the single source of truth;
 * does not consult per-table column entries.
 */
export function projectionOf(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!RUNTIME_ONLY_SET.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
