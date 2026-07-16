import { expect, test } from "@playwright/test";
import { locators } from "../src/locators.ts";

const featureId = "feat-001";

test("feature drill-down summary matches the daemon-served golden fixture", async ({ page }) => {
  await page.goto("/features");
  await page.getByTestId(locators.features.list.link(featureId)).click();
  await page.getByTestId(locators.detailPage.tabTrigger("summary")).click();

  await expect(page.getByTestId(locators.metrics.featureSummary.root)).toBeVisible();
  await expect(page.getByTestId(locators.metrics.featureSummary.headline)).toHaveText("4 human interactions, $11");
  await expect(page.getByTestId(locators.metrics.featureSummary.breakdownRow("approval"))).toHaveText("approval2");
  await expect(page.getByTestId(locators.metrics.featureSummary.breakdownRow("clarification"))).toHaveText("clarification1");
  await expect(page.getByTestId(locators.metrics.featureSummary.breakdownRow("correction"))).toHaveText("correction1");
  await expect(page.getByTestId(locators.metrics.featureSummary.excluded)).toHaveText("Excluded: 1");
});
