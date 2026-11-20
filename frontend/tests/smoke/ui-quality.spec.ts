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

test("网申工具条随页面滚走，不再吸顶（条目 6 守卫）", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/webform");
  await page.waitForLoadState("networkidle");
  const workbar = page.locator('[data-testid="webform-workbar"]');
  await expect(workbar).toBeAttached();
  // 滚动容器是 `.app-content`（`overflow-y: auto`），**不是** window：
  // `window.scrollTo` 在这套壳里滚不动任何东西，用例会假绿。
  //
  // 断言用"位移 === scrollTop"而不是 `top < 0`：`/webform` 空态只有 ~84px 可滚，
  // 写死 300 会滚不到底、`top` 停在 4px，用例在**实现正确时**也红（2026-11-20 实测）。
  // 位移等于滚动量 = 它就是普通流内元素；一旦有人加回 `position: sticky`，位移会变成 0。
  const before = await workbar.evaluate((element) => element.getBoundingClientRect().top);
  const scrolled = await page.locator(".app-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const after = await workbar.evaluate((element) => element.getBoundingClientRect().top);
      return Math.abs(before - after - scrolled);
    })
    .toBeLessThanOrEqual(2);
});

test("求职统计顶部导航出血到内容区两端（条目 7 守卫）", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".analytics-nav")).toBeVisible();
  const bounds = await page.evaluate(() => {
    const nav = document.querySelector(".analytics-nav");
    const content = document.querySelector(".app-content");
    if (!nav || !content) return null;
    return {
      navWidth: nav.getBoundingClientRect().width,
      // clientWidth 含 padding、不含滚动条——正是出血后的导航应有的宽度。
      contentWidth: content.clientWidth,
    };
  });
  // 不断言 left === 0：`.app-content` 在侧栏右侧，视口坐标的 left 本来就不是 0。
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.navWidth - bounds!.contentWidth)).toBeLessThan(1);
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
          // 与 a11y.spec.ts 的 isAcceptedViolation 保持**同一口径**（同一 DOM 形态不能
          // 一个 spec 放行、另一个判红，否则「修好一处又冒出三处」会反复发生）：
          // 1. antd Table 的内部测量行：aria-hidden 且离开文档流，不参与 Tab 序；
          // 2. antd Collapse 的 header（role=tab）里放行级动作（记录条的「···」）——
          //    本项目既有模式，动作经 stopPropagation 隔离且键盘可达，重构 Collapse
          //    结构的影响面远大于收益（评审结论见 a11y.spec.ts 顶部注释）。
          .filter((node) => {
            const target = node.target.join(" ");
            if (violation.id === "aria-hidden-focus" && target.includes("ant-table-measure-row")) {
              return false;
            }
            if (violation.id === "nested-interactive" && target.includes("ant-collapse-header")) {
              return false;
            }
            return true;
          })
          .map((node) => `${violation.id}: ${node.target.join(" ")}`),
      );
    expect(failures, route).toEqual([]);
  }
});
