/**
 * Route path constants (Story 000 T4).
 * One path per dashboard area plus the auth-required redirect target.
 */
export const ROUTES = {
  features: "/features",
  featureDetail: "/features/:featureId",
  featureDetailPath: (featureId: string) => `/features/${featureId}`,
  inbox: "/inbox",
  inboxItem: "/inbox/:id",
  broker: "/broker",
  slots: "/slots",
  budgets: "/budgets",
  ops: "/ops",
  authRequired: "/auth",
} as const;
