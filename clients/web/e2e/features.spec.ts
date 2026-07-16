import { expect, test } from "@playwright/test";
import type { Request } from "@playwright/test";
import { locators } from "../src/locators.ts";

const featureId = "feat-001";

test("features retain live content through manual refresh and show fetch freshness", async ({ page }) => {
  await page.goto("/features");

  const featureLink = page.getByTestId(locators.features.list.link(featureId));
  const featureRow = page.getByTestId(locators.features.list.row).filter({ has: featureLink });
  await expect(featureRow).toContainText("Golden feature");
  await expect(page.getByTestId(locators.pageFreshness.updated)).toHaveText(/^Updated \d{2}:\d{2}$/);

  await page.getByTestId(locators.pageFreshness.refresh).click();

  await expect(featureRow).toContainText("Golden feature");
});

test("authenticated feature list and drill-down render the golden fixture", async ({ page }) => {
  await page.goto("/features");

  const featureLink = page.getByTestId(locators.features.list.link(featureId));
  await expect(featureLink).toHaveText(featureId);
  const featureRow = page.getByTestId(locators.features.list.row).filter({ has: featureLink });
  await expect(featureRow).toContainText(featureId);
  await expect(featureRow).toContainText("Golden feature");
  await expect(featureRow).toContainText("in_progress");
  await expect(featureRow).toContainText("coding");
  await expect(featureRow).toContainText("1/3 tasks satisfied");

  await featureLink.click();

  await expect(page.getByTestId(locators.detailPage.breadcrumb)).toContainText(featureId);
  await expect(page.getByTestId(locators.features.detail.taskRow("feat-001/001-alpha/T1-done"))).toContainText("feat-001/001-alpha/T1-done");
  await expect(page.getByTestId(locators.features.detail.taskRow("feat-001/001-alpha/T2-pending"))).toContainText("feat-001/001-alpha/T2-pending");
  await expect(page.getByTestId(locators.features.detail.dag)).toHaveText("Nodes: 1/3 · Edges: 1/1");
  await expect(page.getByTestId(locators.features.detail.opRow("op_INFLIGHT00000000000000000"))).toContainText("op_INFLIGHT00000000000000000");

  await page.getByTestId(locators.detailPage.tabTrigger("state")).click();
  await expect(page.getByTestId(locators.features.detail.stateView)).toContainText("# Golden State");
  await page.getByTestId(locators.detailPage.tabTrigger("journal")).click();
  await expect(page.getByTestId(locators.features.detail.journalView)).toContainText("# Golden Journal");
});

test("feature reads use authenticated same-origin TLS Connect RPCs", async ({ page }, testInfo) => {
  const rpcRequests: Request[] = [];
  const expectedOrigin = new URL(testInfo.project.use.baseURL as string).origin;

  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/kanthord.v1.DaemonService/")) {
      rpcRequests.push(request);
    }
  });

  await page.goto("/features");
  await page.getByTestId(locators.features.list.link(featureId)).click();
  await expect(page.getByTestId(locators.detailPage.breadcrumb)).toContainText(featureId);

  expect(rpcRequests).not.toHaveLength(0);
  for (const request of rpcRequests) {
    const url = new URL(request.url());
    expect(url.origin).toBe(expectedOrigin);
    expect(url.protocol).toBe("https:");
    expect(request.headers().authorization).toBeTruthy();

    const response = await request.response();
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
  }
});

test("iPhone body stays horizontally contained while the budget ledger scrolls inside its container", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-13", "The desktop project is not a phone-width gate.");

  await page.goto("/budgets");
  const ledger = page.getByTestId(locators.budgets.ledger.table);
  await expect(ledger).toBeVisible();

  const bodyMetrics = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(bodyMetrics.scrollWidth).toBeLessThanOrEqual(bodyMetrics.clientWidth);

  const scrollContainer = await ledger.evaluate((table) => {
    let ancestor = table.parentElement;
    while (ancestor !== null) {
      const overflowX = getComputedStyle(ancestor).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && ancestor.scrollWidth > ancestor.clientWidth) {
        return {
          clientWidth: ancestor.clientWidth,
          overflowX,
          scrollWidth: ancestor.scrollWidth,
        };
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  });
  expect(scrollContainer).not.toBeNull();
});

test("feature controls mount plan actions and the stored pending replan diff", async ({ page }) => {
  await page.goto("/features");
  await page.getByTestId(locators.features.list.link(featureId)).click();
  await page.getByTestId(locators.detailPage.tabTrigger("controls")).click();

  await expect(page.getByTestId(locators.planFlows.signOff.trigger)).toBeVisible();
  await expect(page.getByTestId(locators.planFlows.halt.trigger)).toBeVisible();
  await expect(page.getByTestId(locators.planFlows.replan.baseGeneration)).toHaveText("1");
  await expect(page.getByTestId(locators.diffPane.root)).toBeVisible();
  await expect(page.getByTestId(locators.diffPane.file)).not.toHaveCount(0);
  await expect(page.getByTestId(locators.diffPane.addLine)).not.toHaveCount(0);
});

test("ops exposes only the safe public configuration YAML", async ({ page }) => {
  await page.goto("/ops");

  const configurationCard = page.getByTestId(locators.daemonOps.configurationCard);
  await expect(configurationCard).toBeVisible();
  await expect(page.getByTestId(locators.daemonOps.configurationReadOnly)).toHaveText("Read-only");
  await expect(page.getByTestId(locators.daemonOps.configurationYaml)).toContainText("github.create_pr");

  const cardMarkup = await configurationCard.evaluate((element) => element.outerHTML);
  expect(cardMarkup).not.toMatch(/<(?:input|textarea)\b/i);
  expect(cardMarkup).not.toMatch(/contenteditable/i);
  expect(cardMarkup).not.toMatch(/\b(?:edit|save|upload)\b/i);
});

test("unauthenticated feature navigation renders no feature surface", async ({ browser }, testInfo) => {
  const unauthenticatedBrowser = await browser.browserType().launch();
  const unauthenticatedContext = await unauthenticatedBrowser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { authorization: "" },
  });
  const unauthenticatedPage = await unauthenticatedContext.newPage();

  try {
    await unauthenticatedPage.goto(new URL("/features", testInfo.project.use.baseURL as string).toString());

    await expect(unauthenticatedPage.getByTestId(locators.auth.required)).toBeVisible();
    await expect(unauthenticatedPage.getByTestId(locators.features.list.table)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.list.row)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.list.empty)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.list.link(featureId))).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.tasks)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.tasksTable)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.taskRow("feat-001/001-alpha/T1-done"))).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.taskRow("feat-001/001-alpha/T2-pending"))).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.dag)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.ops)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.opsTable)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.opRow("op_INFLIGHT00000000000000000"))).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.stateView)).toHaveCount(0);
    await expect(unauthenticatedPage.getByTestId(locators.features.detail.journalView)).toHaveCount(0);
  } finally {
    await unauthenticatedContext.close();
    await unauthenticatedBrowser.close();
  }
});
