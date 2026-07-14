import { test, expect } from "@playwright/test";
import { locators } from "../src/locators.ts";

// SU7 bootstrap E2E: the dashboard loads over TLS (the preflight serves the
// self-signed SU5 cert) and renders the token-styled hello-world primitive.
// Proves browser-over-TLS + the design path end to end.
test("dashboard loads over TLS and renders the hello-world banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId(locators.helloBanner.title)).toHaveText("kanthord control plane");
  await expect(page.getByTestId(locators.helloBanner.action)).toBeVisible();
});
