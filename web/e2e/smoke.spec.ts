import { expect, test, type Page } from "@playwright/test";

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("dashboard renders every chart view from measured data", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /measured, not marketed/i })).toBeVisible();
  for (const name of ["Price vs performance", "Work per euro", "CPU", "Memory", "Disk", "Network", "The board"]) {
    await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeAttached();
  }
  await expect(page.getByRole("img", { name: /price per month against composite score/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Hetzner cx23/ }).first()).toBeAttached();

  // The legacy category URL lands on the dashboard.
  await page.goto("/compute");
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

test("plan filters narrow every chart and reset restores them", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Plans" });
  const plan = sidebar.getByRole("button", { name: /^cx23/ });
  await expect(plan).toHaveAttribute("aria-pressed", "true");
  await plan.click();
  await expect(plan).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("link", { name: /^Hetzner cx23/ })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Reset plan filters" }).click();
  await expect(page.getByRole("link", { name: /^Hetzner cx23/ }).first()).toBeAttached();
  expect(errors).toEqual([]);
});

test("theme toggle switches between the light and dark palettes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(html).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.reload();
  await expect(html).toHaveClass(/dark/);
});

test("provider pages expose manifest-backed raw report links", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/providers/hetzner");
  await expect(page.getByRole("heading", { level: 1, name: "Hetzner" })).toBeVisible();
  await expect(page.getByText(/compute-cli-|compute-v2/).first()).toBeVisible();
  const rawLink = page.locator('a[href*="/data/results/"][href$=".json"]').first();
  await expect(rawLink).toBeVisible();
  await expect(rawLink).toHaveAttribute(
    "href",
    /github\.com\/niklas-schmidt-dev\/providerbench\/blob\/main\/data\/results\/.+\.json/,
  );

  await page.goto("/providers/vercel");
  await expect(page.getByRole("heading", { level: 1, name: "Vercel" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("command palette navigates without a full-page failure", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Benchmarks, providers, pages…");
  await expect(input).toBeVisible();
  await input.fill("CLI contributing");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/cli$/);
  await expect(
    page.getByRole("heading", { name: "One binary, ninety seconds, every number on this site" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

// The tests below run against the synthetic reports in e2e/fixtures/reports,
// which the build overlays on the published dataset.

test("a category the site has no code for lays itself out from its reports", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/gpu-inference");
  await expect(page.getByRole("heading", { level: 1, name: "GPU inference benchmarks" })).toBeVisible();
  await expect(page.getByText(/sample data/i)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).first().getByRole("link", { name: "GPU inference" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Mixed metrics: a bar chart with a switch. The report states unit and direction.
  await expect(page.getByRole("heading", { level: 2, name: "Decode", exact: true })).toBeAttached();
  await expect(page.getByRole("img", { name: "Decode · Tokens per second per plan" })).toBeVisible();
  await page.getByRole("group", { name: "Decode metric" }).getByRole("button", { name: "Time to first token P50" }).click();
  await expect(page.getByText("ms · lower is better")).toBeVisible();

  // Like-for-like metrics: one table on one scale.
  const matrix = page.locator("#batch table");
  await expect(matrix.getByRole("columnheader", { name: "B64" })).toBeVisible();
  await expect(matrix.getByRole("row", { name: /Initech h100/ }).getByRole("cell").first()).toHaveText("310");

  // Priced rows get the price scatter; no ranking means no score column.
  await expect(page.getByRole("img", { name: /price per month against decode · tokens per second/i })).toBeVisible();
  const board = page.locator("#board");
  await expect(board.getByRole("columnheader", { name: /Decode · Tokens per second/ })).toBeVisible();
  await expect(board.getByRole("columnheader", { name: "Score" })).toHaveCount(0);
  await expect(page.locator("#method")).toContainText("gpu-inference-v1");
  expect(errors).toEqual([]);
});

test("tests that share their metrics share one matrix, with every item's outcome below", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/ai-language");
  await expect(page.getByRole("complementary", { name: "Models" })).toBeVisible();
  const matrix = page.locator("#accuracy");
  await expect(matrix.getByRole("heading", { level: 2, name: "Problems solved by input language" })).toBeVisible();
  await expect(matrix.getByRole("columnheader").nth(1)).toHaveText("English");

  // All tests: the mean over the five tests. One test: its own share.
  const row = matrix.getByRole("row", { name: /Globex model-x/ });
  await expect(row.getByRole("cell").nth(1)).toHaveText("88");
  await matrix.getByRole("button", { name: "Arithmetic" }).click();
  await expect(row.getByRole("cell").nth(1)).toHaveText("50");

  const items = page.locator("#outcomes");
  await expect(items.getByRole("img", { name: "Globex model-x, German: 5 of 10 items solved" })).toBeVisible();
  await expect(items.getByRole("img", { name: "Acme model-small, Chinese: 8 of 10 items solved, 1 without a usable answer" })).toBeVisible();
  await expect(items.getByText("Level 5")).toBeVisible();

  // Hiding a model in the sidebar removes it from every view.
  await page.getByRole("complementary", { name: "Models" }).getByRole("button", { name: /^model-x/ }).click();
  await expect(matrix.getByRole("row", { name: /Globex model-x/ })).toHaveCount(0);
  await expect(items.getByRole("img", { name: /Globex model-x/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the index lists every category, and one without reports says how to run it", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/benchmarks");
  await expect(page.getByRole("heading", { level: 1, name: "Everything on the bench" })).toBeVisible();
  const main = page.getByRole("main");
  for (const name of ["Compute", "AI language", "GPU inference", "Workload", "Object Storage"]) {
    await expect(main.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await main.getByRole("link", { name: /^Workload/ }).click();
  await expect(page).toHaveURL(/\/workload$/);
  await expect(page.getByRole("heading", { level: 1, name: "Workload benchmarks" })).toBeVisible();
  await expect(page.getByText("providerbench run --category workload")).toBeVisible();
  await expect(page.getByText(/TLS 1\.3 handshakes/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a provider nobody registered has a page, and search finds what the reports hold", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/providers/globex");
  await expect(page.getByRole("heading", { level: 1, name: "Globex" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "AI language: every cohort" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Arithmetic · German/ })).toContainText("50.0");

  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Benchmarks, providers, pages…");
  await input.fill("Batch B16");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/gpu-inference#batch-throughput_b16$/);
  await expect(page.locator("#batch table")).toBeVisible();

  // A metric may be named with spaces: its link still selects it.
  await page.keyboard.press("Control+k");
  await input.fill("Time to first token");
  await input.press("Enter");
  await expect(page).toHaveURL(/#decode-time%20to%20first%20token%20p50$/);
  await expect(page.getByRole("group", { name: "Decode metric" }).getByRole("button", { name: "Time to first token P50" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});
