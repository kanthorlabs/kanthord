import { test, expect } from "@playwright/test";
import { locators } from "../src/locators.ts";

// Bootstrap smoke: the production bundle reaches the live AppShell over TLS.
test("dashboard loads over TLS inside the app shell", async ({ page }, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "iphone-13") {
    await expect(page.getByTestId(locators.appShell.mobileToggle)).toBeVisible();
    await page.getByTestId(locators.appShell.mobileToggle).click();
    await expect(page.getByTestId(locators.appShell.navItem("features"))).toBeVisible();
  } else {
    await expect(page.getByTestId(locators.appShell.nav)).toBeVisible();
  }
  await expect(page.getByTestId(locators.appShell.content)).toBeVisible();
  await expect(page.getByTestId(locators.features.list.table)).toBeVisible();
});
