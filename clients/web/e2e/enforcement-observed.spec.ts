import { expect, test } from "@playwright/test";
import { locators } from "../src/locators.ts";

function fixtureSuffix(projectName: string): "desktop" | "mobile" {
  if (projectName === "desktop-chromium") return "desktop";
  if (projectName === "iphone-13") return "mobile";
  throw new Error(`Unsupported Playwright project: ${projectName}`);
}

test("ring-1 block is visible and can receive its suggested correction", async ({ page }, testInfo) => {
  const escalationId = `e2e-ring1-blocked-${fixtureSuffix(testInfo.project.name)}`;

  await page.goto("/inbox");
  await page.getByTestId(locators.inbox.list.itemLink(escalationId)).click();

  await expect(page.getByTestId(locators.inbox.item.evidence)).toContainText("src/forbidden/secret.ts");
  await page.getByTestId(locators.inbox.respond.acceptButton).click();
  await expect(page.getByTestId(locators.inbox.respond.successState)).toBeVisible();
});

test("parked github merge proceeds after dialog approval", async ({ page }, testInfo) => {
  const approvalId = `e2e-github-merge-${fixtureSuffix(testInfo.project.name)}`;

  await page.goto("/inbox");
  await page.getByTestId(locators.inbox.list.itemLink(approvalId)).click();

  await expect(page.getByTestId(locators.approvals.verb)).toHaveText("github.merge");
  await expect(page.getByTestId(locators.approvals.target)).toHaveText("acme/kanthord#42");
  await page.getByTestId(locators.approvals.approveTrigger).click();
  await expect(page.getByTestId(locators.confirmDialog.content)).toBeVisible();
  await page.getByTestId(locators.confirmDialog.confirm).click();
  await expect(page.getByTestId(locators.approvals.successState)).toBeVisible();

  await page.goto("/broker");
  await expect(page.getByTestId(locators.broker.ops.groupInFlight)).toContainText("github.merge");
});
