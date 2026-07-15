// Locator registry (SE-owned, DESIGN §8). Tests query by these ids, never by
// raw strings. Grouped by surface. Seeded with the SU7 hello-world.
export const locators = {
  helloBanner: {
    title: "hello-banner-title",
    action: "hello-banner-action",
  },
  pipelinePing: {
    label: "pipeline-ping-label",
    badge: "pipeline-ping-badge",
  },
  // Story 000 T1
  dataStates: {
    loading: "data-states-loading",
    empty: "data-states-empty",
    error: "data-states-error",
  },
  // Story 000 T2 — AppShell nav + layout regions (DESIGN §6, §8)
  appShell: {
    nav: "app-shell-nav",
    // navItem is a function — valid as a const object property (PROFILE)
    navItem: (area: string) => `app-shell-nav-item-${area}`,
    mobileToggle: "app-shell-mobile-toggle",
    navBadge: "app-shell-nav-badge",
    mobileIndicator: "app-shell-mobile-indicator",
    header: "app-shell-header",
    content: "app-shell-content",
  },
  // Story 000 T3 — ListPage template slots
  listPage: {
    title: "list-page-title",
    toolbar: "list-page-toolbar",
    content: "list-page-content",
  },
  // Story 000 T4 — per-area placeholders (real surfaces come from later stories)
  features: {
    placeholder: "features-placeholder",
    // Story 001 T1 — features list surface
    list: {
      row: "features-list-row",
      empty: "features-list-empty",
      table: "features-list-table",
    },
    // Story 001 T2 — feature drill-down surface
    detail: {
      tasks: "features-detail-tasks",
      taskRow: (id: string) => `features-detail-task-row-${id}`,
      dag: "features-detail-dag",
      ops: "features-detail-ops",
      opRow: (id: string) => `features-detail-op-row-${id}`,
      stateView: "features-detail-state-view",
      journalView: "features-detail-journal-view",
      tasksTable: "features-detail-tasks-table",
      opsTable: "features-detail-ops-table",
    },
  },
  inbox: {
    placeholder: "inbox-placeholder",
    // Story 003 T1 — inbox list surface (DESIGN §8)
    list: {
      table: "inbox-list-table",
      row: "inbox-list-row",
      empty: "inbox-list-empty",
      typeFilter: "inbox-list-type-filter",
      typeFilterItem: (type: string) => `inbox-list-type-filter-item-${type}`,
    },
    // Story 003 T1 — inbox item deep-link view (DESIGN §8)
    item: {
      root: "inbox-item-root",
      evidence: "inbox-item-evidence",
      resolvedState: "inbox-item-resolved-state",
      expiredState: "inbox-item-expired-state",
      missingState: "inbox-item-missing-state",
    },
    // Story 003 T2 — respond flow (DESIGN §8)
    respond: {
      acceptButton: "inbox-respond-accept-button",
      overrideTrigger: "inbox-respond-override-trigger",
      categorySelectTrigger: "inbox-respond-category-select-trigger",
      categorySelectItem: (cat: string) => `inbox-respond-category-select-item-${cat}`,
      submitButton: "inbox-respond-submit-button",
      fieldError: "inbox-respond-field-error",
      apiError: "inbox-respond-api-error",
      successState: "inbox-respond-success-state",
      nextOpenItem: "inbox-respond-next-open-item",
      backToInbox: "inbox-respond-back-to-inbox",
    },
  },
  broker: {
    placeholder: "broker-placeholder",
    // Story 005 T1 — broker operations surface (DESIGN §8)
    ops: {
      table: "broker-ops-table",
      row: "broker-ops-row",
      groupInFlight: "broker-ops-group-in-flight",
      groupPending: "broker-ops-group-pending",
      groupExpiring: "broker-ops-group-expiring",
      empty: "broker-ops-empty",
    },
    // Story 005 T1 — verb registry surface (DESIGN §8)
    verbs: {
      table: "broker-verbs-table",
      row: "broker-verbs-row",
      empty: "broker-verbs-empty",
    },
  },
  slots: {
    placeholder: "slots-placeholder",
    // Story 005 T2 — repo slots surface (DESIGN §8)
    table: "slots-table",
    row: "slots-row",
    empty: "slots-empty",
  },
  budgets: {
    placeholder: "budgets-placeholder",
    // Story 006 T1 — per-task ledger + override flow (DESIGN §8)
    ledger: {
      table: "budgets-ledger-table",
      row: "budgets-ledger-row",
      empty: "budgets-ledger-empty",
    },
    override: {
      trigger: (taskId: string) => `budgets-override-trigger-${taskId}`,
      apiError: "budgets-override-api-error",
      successState: "budgets-override-success-state",
    },
  },
  ops: {
    placeholder: "ops-placeholder",
  },
  // Story 006 T1 — BreakerStateBadge domain badge (DESIGN §4, §8)
  // (placed under status alongside the other domain badges)
  // Story 006 T2 — OpsPage card-grid template (DESIGN §6, §8)
  opsPage: {
    root: "ops-page-root",
    card: "ops-page-card",
  },
  // Story 006 T2 — DaemonOps view (DESIGN §8)
  daemonOps: {
    healthCard: "daemon-ops-health-card",
    pingTime: "daemon-ops-ping-time",
    tasksProcessed: "daemon-ops-tasks-processed",
    tasksProcessedUnavailable: "daemon-ops-tasks-processed-unavailable",
    noPingState: "daemon-ops-no-ping-state",
    verifyTrigger: "daemon-ops-verify-trigger",
    verifyReport: "daemon-ops-verify-report",
    verifyOutcome: "daemon-ops-verify-outcome",
    // B3 — inline error element when triggerVerify rejects
    verifyError: "daemon-ops-verify-error",
  },
  // Story 001 T2 — DetailPage template (DESIGN §6, §8)
  detailPage: {
    breadcrumb: "detail-page-breadcrumb",
    tabTrigger: (id: string) => `detail-page-tab-trigger-${id}`,
    tabPanel: (id: string) => `detail-page-tab-panel-${id}`,
  },
  // Story 001 T1/T2 — status badge locators (DESIGN §4)
  status: {
    featureBadge: "status-feature-badge",
    taskBadge: "status-task-badge",
    // Story 003 T1 — escalation severity badge (DESIGN §4)
    severityBadge: "status-severity-badge",
    unclassifiedBadge: "status-unclassified-badge",
    // Story 004 T1 — approval state badge (DESIGN §4)
    approvalStateBadge: "status-approval-state-badge",
    // Story 006 T1 — circuit-breaker state badge (DESIGN §4)
    breakerStateBadge: "status-breaker-state-badge",
  },
  // Story 001 T4 — auth-required screen (DESIGN §7)
  auth: {
    required: "auth-required",
  },
  // Story 004 T1 — approval-tier verb actions (DESIGN §5 approval-tier verbs)
  approvals: {
    verb: "approvals-verb",
    target: "approvals-target",
    approveTrigger: "approvals-approve-trigger",
    expiredAlert: "approvals-expired-alert",
    successState: "approvals-success-state",
    // B4 — inline error element when respondToApproval rejects
    errorState: "approvals-error-state",
  },
  // Story 002 T2 — ConfirmActionDialog composite (DESIGN §7 destructive-confirm)
  confirmDialog: {
    trigger: "confirm-dialog-trigger",
    content: "confirm-dialog-content",
    confirm: "confirm-dialog-confirm",
    cancel: "confirm-dialog-cancel",
    input: "confirm-dialog-input",
  },
  // Story 002 T3 — DiffPane composite (DESIGN §5 diff pane)
  diffPane: {
    root: "diff-pane-root",
    file: "diff-pane-file",
    addLine: "diff-pane-add-line",
    delLine: "diff-pane-del-line",
  },
  // Story 002 — plan-flow surfaces
  planFlows: {
    // T1 — sign-off flow
    signOff: {
      trigger: "plan-flows-sign-off-trigger",
      result: "plan-flows-sign-off-result",
      generation: "plan-flows-sign-off-generation",
      diagnostic: "plan-flows-sign-off-diagnostic",
    },
    // T2 — halt flow
    halt: {
      trigger: "plan-flows-halt-trigger",
      result: "plan-flows-halt-result",
      conflict: "plan-flows-halt-conflict",
    },
    // T3 — re-planning diff approval flow
    replan: {
      baseGeneration: "plan-flows-replan-base-generation",
      approve: "plan-flows-replan-approve",
      reopenedTasks: "plan-flows-replan-reopened-tasks",
      conflict: "plan-flows-replan-conflict",
    },
  },
} as const;
