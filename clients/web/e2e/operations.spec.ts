import { expect, test } from "@playwright/test";
import { locators } from "../src/locators.ts";

test("Broker, Slots, Budgets, and Ops render the live golden values", async ({ page }) => {
  await page.goto("/broker");
  await expect(page.getByTestId(locators.broker.ops.groupInFlight)).toContainText("in_flight");
  await expect(page.getByTestId(locators.broker.ops.groupInFlight)).toContainText("idem-golden");
  await expect(page.getByTestId(locators.broker.ops.groupInFlight)).toContainText("deploy_service");
  const verbRows = page.getByTestId(locators.broker.verbs.row);
  await expect(verbRows).toHaveCount(2);
  await expect(verbRows.nth(0)).toContainText("deploy_service");
  await expect(verbRows.nth(0)).toContainText("auto");
  await expect(verbRows.nth(1)).toContainText("github.merge");
  await expect(verbRows.nth(1)).toContainText("approval_required");

  await page.goto("/slots");
  const slot = page.getByTestId(locators.slots.row);
  await expect(slot).toContainText("/repos/kanthord");
  await expect(slot).toContainText("worktree");
  await expect(slot).toContainText("fixture-control");
  await expect(slot).toContainText("session-golden");

  await page.goto("/budgets");
  const budget = page.getByTestId(locators.budgets.ledger.row);
  await expect(budget).toContainText("feat-001/001-alpha/T1-done");
  await expect(budget).toContainText("11");
  await expect(budget).toContainText("20");
  await expect(budget).toContainText("closed");

  await page.goto("/ops");
  await expect(page.getByTestId(locators.daemonOps.noPingState)).toHaveText("No ping recorded");
  await expect(page.getByTestId(locators.daemonOps.tasksProcessedUnavailable)).toHaveText("Tasks processed count not yet available");
  await page.getByTestId(locators.daemonOps.verifyTrigger).click();
  await expect(page.getByTestId(locators.daemonOps.verifyReport)).toBeVisible();
  await expect(page.getByTestId(locators.daemonOps.verifyOutcome)).toHaveText("pass");
});
