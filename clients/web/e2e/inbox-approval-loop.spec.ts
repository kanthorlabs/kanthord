import { expect, test } from "@playwright/test";
import { locators } from "../src/locators.ts";

function fixtureSuffix(projectName: string): "desktop" | "mobile" {
  if (projectName === "desktop-chromium") return "desktop";
  if (projectName === "iphone-13") return "mobile";
  throw new Error(`Unsupported Playwright project: ${projectName}`);
}

test("typed escalation response resolves the daemon-backed inbox item", async ({ page }, testInfo) => {
  const escalationId = `e2e-approval-loop-${fixtureSuffix(testInfo.project.name)}`;

  await page.goto("/inbox");
  await page.getByTestId(locators.inbox.list.itemLink(escalationId)).click();

  await expect(page.getByTestId(locators.inbox.item.evidence)).toContainText("Golden approval evidence");
  await page.getByTestId(locators.inbox.respond.overrideTrigger).click();
  await page.getByTestId(locators.inbox.respond.categorySelectTrigger).click();
  await page.getByTestId(locators.inbox.respond.categorySelectItem("correction")).click();
  await page.getByTestId(locators.inbox.respond.submitButton).click();
  await expect(page.getByTestId(locators.inbox.respond.successState)).toBeVisible();

  await page.getByTestId(locators.inbox.respond.backToInbox).click();
  await expect(page.getByTestId(locators.inbox.list.itemLink(escalationId))).toHaveCount(0);
});
