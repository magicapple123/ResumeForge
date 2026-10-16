import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = [
  "/",
  "/jobs",
  "/resumes",
  "/apply",
  "/webform",
  "/tracker",
  "/interview",
  "/assistant",
  "/settings",
  "/profile",
  "/favorites",
  "/materials",
  "/knowledge",
  "/skills",
  "/analytics",
  "/claims",
  "/trash",
  "/claims/drill",
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
});

for (const width of [375, 768, 1200]) {
  test(`${width}px: all pages keep content and actions inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const bounds = await page.getByRole("main").evaluate((main) => ({
        documentOverflow: document.documentElement.scrollWidth - innerWidth,
        contentOverflow: main.scrollWidth - main.clientWidth,
      }));
      expect(bounds.documentOverflow, `${route}: document overflow`).toBeLessThanOrEqual(1);
      expect(bounds.contentOverflow, `${route}: clipped content`).toBeLessThanOrEqual(1);
      if (width === 375) await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
    }
  });
}

test("mobile navigation works by keyboard and returns focus on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/jobs");
  const skip = page.getByRole("link", { name: "跳到主要内容" });
  // goto's load event can precede the dataset bootstrap / React mount.
  // Wait for the actual keyboard target without moving focus to it.
  await expect(skip).toBeAttached();
  await page.bringToFront();
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const toggle = page.getByRole("button", { name: "打开导航" });
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "功能导航" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await drawer.getByRole("menuitem", { name: "简历中心", exact: true }).click();
  await expect(page).toHaveURL(/\/resumes$/);
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
});

test("all pages have no serious or critical WCAG violations", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1200, height: 900 });
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const failures = result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
      .flatMap((violation) =>
        violation.nodes
          // Same bounded Ant Design measurement-row exception as a11y.spec.ts.
          .filter(
            (node) =>
              !(
                violation.id === "aria-hidden-focus" &&
                node.target.join(" ").includes("ant-table-measure-row")
              ),
          )
          .map((node) => `${violation.id}: ${node.target.join(" ")}`),
      );
    expect(failures, route).toEqual([]);
  }
});
