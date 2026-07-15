/**
 * Route path constants (Story 000 T4).
 * One path per nav area + the auth-required redirect target.
 * Stories 001–007 register their real surfaces on these paths.
 */
export const ROUTES = {
  features: "/features",
  inbox: "/inbox",
  inboxItem: "/inbox/:id",
  broker: "/broker",
  slots: "/slots",
  budgets: "/budgets",
  ops: "/ops",
  authRequired: "/auth",
} as const;
