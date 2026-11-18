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
