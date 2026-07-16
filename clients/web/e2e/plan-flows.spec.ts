import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { locators } from "../src/locators.ts";

function controlFixture(projectName: string) {
  if (projectName !== "desktop-chromium" && projectName !== "iphone-13") {
    throw new Error(`Unsupported Playwright project: ${projectName}`);
  }

  const suffix = projectName === "desktop-chromium" ? "desktop" : "mobile";
  return {
    // These IDs must be independently seeded by the E2E fixture for each project.
    haltFeatureId: `e2e-plan-halt-${suffix}`,
    haltTaskId: `e2e-plan-halt-${suffix}/001-control/T1-running`,
    replanFeatureId: `e2e-plan-replan-${suffix}`,
    replanReopenedTaskId: `e2e-plan-replan-${suffix}/001-control/T1-reopened`,
    signOffFeatureId: `e2e-plan-signoff-${suffix}`,
    signOffGeneration: "2",
  };
}

async function openControls(page: Page, featureId: string) {
  await page.goto("/features");
  const featureLink = page.getByTestId(locators.features.list.link(featureId));
  await expect(featureLink).toBeVisible();
  await featureLink.click();
  await page.getByTestId(locators.detailPage.tabTrigger("controls")).click();
}

test("isolated control fixture signs off its valid plan at the expected generation", async ({ page }, testInfo) => {
  const fixture = controlFixture(testInfo.project.name);

  await openControls(page, fixture.signOffFeatureId);
  await page.getByTestId(locators.planFlows.signOff.trigger).click();
  await expect(page.getByTestId(locators.planFlows.signOff.result)).toBeVisible();
  await expect(page.getByTestId(locators.planFlows.signOff.generation)).toHaveText(fixture.signOffGeneration);
});

test("isolated control fixture confirms halt and identifies the acting operator", async ({ page }, testInfo) => {
  const fixture = controlFixture(testInfo.project.name);

  await openControls(page, fixture.haltFeatureId);
  await page.getByTestId(locators.planFlows.halt.trigger).click();
  await expect(page.getByTestId(locators.confirmDialog.content)).toBeVisible();
  await page.getByTestId(locators.confirmDialog.confirm).click();
  await expect(page.getByTestId(locators.planFlows.halt.result)).toContainText("halted");
  await expect(page.getByTestId(locators.planFlows.halt.result)).toContainText("operator@kanthord");
  await expect(page.getByTestId(locators.features.detail.taskRow(fixture.haltTaskId))).toHaveCount(1);
});

test("isolated control fixture approves its pending replan and lists reopened tasks", async ({ page }, testInfo) => {
  const fixture = controlFixture(testInfo.project.name);

  await openControls(page, fixture.replanFeatureId);
  await expect(page.getByTestId(locators.planFlows.replan.baseGeneration)).toHaveText("1");
  await page.getByTestId(locators.planFlows.replan.approve).click();
  await expect(page.getByTestId(locators.planFlows.replan.reopenedTasks)).toContainText(fixture.replanReopenedTaskId);
});
