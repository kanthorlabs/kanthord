// Locator registry (SE-owned, DESIGN §8). Tests query by these ids, never by
// raw strings. Grouped by surface. Seeded with the SU7 hello-world.
export const locators = {
  helloBanner: {
    title: "hello-banner-title",
    action: "hello-banner-action",
  },
} as const;
