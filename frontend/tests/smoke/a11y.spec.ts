import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { dismissGuide, test } from "./helpers";

/**
 * 可访问性冒烟（RF-22 建，RF-12 扩）：真实浏览器里检查窄窗口、高缩放、键盘与 axe 扫描。
 *
 * - 375px 窄窗：页面无横向溢出（scrollWidth 口径），关键控件仍可见——这是移动
 *   浏览器 / 分屏场景下"还能不能用"的底线。
 * - 200% 缩放：用 body zoom 模拟浏览器放大 200%（等比放大全部渲染内容），
 *   主入口仍可见。
 * - 1366 宽：核心页面无整页横向溢出（常见笔记本分辨率下限）。
 * - 键盘：首启动引导可用 Esc 关闭；Tab 能把焦点带进侧栏的功能入口。
 * - axe 自动扫描：核心页面跑 axe-core（WCAG 2.1 AA 规则），critical/serious
 *   违规视为失败。**自动扫描不等于 WCAG 认证**——它只能捕到规则可表达的
 *   问题（对比度、名称、landmark），键盘路径与语义正确性仍靠人工核查。
 */

/** 无横向溢出口径：文档滚动宽度最多超出视口 1px（容忍亚像素取整）。 */
async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/**
 * 已知可接受项的白名单（每条都写明为什么不算失败）：
 * - `.ant-table-measure-row` 的 aria-hidden-focus：antd Table 内部测量行，
 *   aria-hidden 且离开文档流，不参与 Tab 序，属 antd 实现细节的误报。
 * - `.ant-collapse-header` 的 nested-interactive：antd Collapse 的 header（role=tab）
 *   里放行级动作（如记录条的「···」）是本项目的既有模式，动作经 span.stopPropagation
 *   隔离且键盘可达；重构 Collapse 结构的影响面远大于收益，记录为已知取舍。
 */
function isAcceptedViolation(id: string, target: string): boolean {
  if (id === "aria-hidden-focus" && target.includes("ant-table-measure-row")) return true;
  if (id === "nested-interactive" && target.includes("ant-collapse-header")) return true;
  return false;
}

test.describe("375px 窄窗", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("首页：页头标题可见，无横向溢出", async ({ page }) => {
    await page.goto("/");
    await dismissGuide(page);
    await expect(page.getByText("AI 定制化简历生成平台")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("简历中心：搜索入口可见，无横向溢出", async ({ page }) => {
    await page.goto("/resumes");
    await dismissGuide(page);
    await expect(page.getByPlaceholder("搜索简历记录")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("1366 宽（常见笔记本下限）", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("核心页面无整页横向溢出", async ({ page }) => {
    for (const path of ["/", "/resumes", "/apply", "/webform"]) {
      await page.goto(path);
      await dismissGuide(page);
      await page.waitForTimeout(300);
      await expectNoHorizontalOverflow(page);
    }
  });
});

test.describe("axe 自动扫描", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("核心页面无 critical/serious 违规", async ({ page }) => {
    for (const path of ["/", "/resumes", "/apply", "/webform"]) {
      await page.goto(path);
      await dismissGuide(page);
      // 等首屏数据落地，避免把"加载中骨架"当成终态扫进去。
      await page.waitForLoadState("networkidle").catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations
        .filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
        .flatMap((v) =>
          v.nodes
            .filter((n) => !isAcceptedViolation(v.id, n.target.join(" ")))
            .map((n) => `${path} ${v.id}: ${n.target.join(" ").slice(0, 80)}`),
        );
      // 报告里带上违规摘要（页面 + 规则 + 目标选择器），失败时可直接定位。
      expect(blocking, "axe 在核心页面发现 critical/serious 违规").toEqual([]);
    }
  });
});

test.describe("200% 缩放", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("放大后侧栏主入口仍然可见", async ({ page }) => {
    await page.goto("/");
    await dismissGuide(page);
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    await expect(page.getByRole("menuitem", { name: "首页" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "简历中心" })).toBeVisible();
  });
});

test.describe("键盘操作", () => {
  test("Esc 关闭首启动引导，Tab 焦点能进入侧栏功能入口", async ({ page }) => {
    await page.goto("/");

    // 首启动可能同时弹「使用指南」与「近期提醒」（激活数据集里有逾期提醒时，
    // 提醒弹窗也会接管焦点）。两者都清场后，Esc 与 Tab 验证的才是页面本身。
    const guide = page.getByRole("dialog").filter({ hasText: "欢迎使用简历通" });
    const reminder = page.getByRole("dialog").filter({ hasText: "近期提醒" });
    await guide.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    for (let round = 0; round < 4; round += 1) {
      if (await reminder.isVisible().catch(() => false)) {
        await reminder.getByRole("button", { name: /知道\s*了/ }).click();
      } else if (await guide.isVisible().catch(() => false)) {
        // 引导本身用键盘关闭（antd Modal 默认支持 Esc）。
        await page.keyboard.press("Escape");
      } else {
        break;
      }
      await page.waitForTimeout(300);
    }
    await expect(guide).toHaveCount(0);
    await expect(reminder).toHaveCount(0);

    // Tab 若干次内必须能把焦点带到侧栏的「使用指南」按钮：焦点顺序能走进
    // 主入口的交互元素，而不是被不可聚焦的布局节点卡死。
    let reached = false;
    for (let presses = 0; presses < 10 && !reached; presses += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") === "使用指南",
      );
    }
    expect(reached).toBe(true);
  });
});
