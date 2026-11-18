import { expect, test, type Page } from "@playwright/test";

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("homepage and compute comparison render measured data", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /measured/i }).first()).toBeVisible();
  await expect(page.getByText("All 16 compute metrics")).toBeVisible();

  await page.goto("/compute");
  await expect(
    page.getByRole("heading", { name: "Contention & consistency signals" }),
  ).toBeVisible();
  await expect(page.getByText(/compute-cli-|compute-v2/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("provider pages expose manifest-backed raw report links", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/providers/hetzner");
  await expect(page.getByRole("heading", { name: "Hetzner" })).toBeVisible();
  const rawLink = page.locator('a[href*="/data/results/"][href$=".json"]').first();
  await expect(rawLink).toBeVisible();
  await expect(rawLink).toHaveAttribute(
    "href",
    /github\.com\/niklas-schmidt-dev\/providerbench\/blob\/main\/data\/results\/.+\.json/,
  );

  await page.goto("/providers/vercel");
  await expect(page.getByRole("heading", { name: "Vercel" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("command palette navigates without a full-page failure", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Benchmarks, providers, pages…");
  await expect(input).toBeVisible();
  await input.fill("CLI contributing");
  await page.getByText("CLI & contributing", { exact: true }).click();
  await expect(page).toHaveURL(/\/cli$/);
  await expect(
    page.getByRole("heading", {
      name: "One binary, ninety seconds, every number on this site",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
