import { expect, test } from "@playwright/test";

/**
 * 投递台首屏密度（#14G/#14H 第二版）——**几何断言**，jsdom 里量不了坐标的那部分。
 *
 * 为什么必须单独有这一条：`ApplyQueuePanel` 的单测只能证明"元素存在/折叠"，
 * 而 #14 的判据是**首屏能放几行表格**（1366×768 下 ≥7 行）。第一版实现把横幅和
 * 四步引导收起来了，单测全绿，实测首屏却只剩 2 行——就是因为没有一条用例真的去量
 * `getBoundingClientRect()`。这里量三个数：首行 Y、行高、可见行数。
 *
 * 运行方式（应用需先在目标地址活着）：
 *   SMOKE_FRONTEND_URL=http://127.0.0.1:5173 npx playwright test tests/smoke/apply-first-screen.spec.ts
 */

const FIRST_ROW_BUDGET = 300; // 首行顶部 Y（含站点行/浏览器卡/页签/工具栏/表头）
const MIN_VISIBLE_ROWS = 7; // PRD 判据：1366×768 首屏 ≥7 行

test.beforeEach(async ({ page }) => {
  // 首启动引导会盖住页面且吃掉首屏高度，先在导航前标记"已看过"。
  await page.addInitScript(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
});

test("1366×768：投递队列首屏至少放得下 7 行，且工具栏/浏览器卡各占一行", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/apply");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape").catch(() => {});

  // 三块"吃掉首屏"的元凶各自的高度上限：一整行 ≈ 44（浏览器卡含扫码提示时 48）。
  const browserBar = await page.locator(".apply-browser-bar").boundingBox();
  expect(browserBar, "浏览器状态卡应渲染").not.toBeNull();
  expect(browserBar!.height, "浏览器卡必须是一行（#14G）").toBeLessThanOrEqual(56);

  const toolbar = await page.locator(".apply-queue-head").boundingBox();
  expect(toolbar, "队列工具栏应渲染").not.toBeNull();
  expect(toolbar!.height, "队列工具栏必须是一行（#14H）").toBeLessThanOrEqual(44);

  const header = await page.locator(".ant-table-thead").first().boundingBox();
  expect(header, "表头应渲染").not.toBeNull();

  const rows = page.locator(".ant-table-tbody tr.ant-table-row");
  const count = await rows.count();

  if (count === 0) {
    // 空队列时没有行可量，退一步断"表头本身也在首屏内"——否则同一块布局出问题时
    // 这条用例会因为没有数据而永远绿。
    expect(header!.y, "空队列时表头也必须在首屏内").toBeLessThanOrEqual(FIRST_ROW_BUDGET);
    return;
  }

  const first = await rows.first().boundingBox();
  expect(first, "首行应可测量").not.toBeNull();

  // 判据一：首行顶部 ≤ 300（第一版实测 618.14）。
  expect(first!.y, "首行顶部 Y 必须 ≤ 300（#14G/#14H）").toBeLessThanOrEqual(FIRST_ROW_BUDGET);

  // 判据二：可见行数 ≥ 7（第一版实测 2）。
  const visibleRows = Math.floor((768 - first!.y) / first!.height);
  expect(visibleRows, "首屏可见行数必须 ≥ 7").toBeGreaterThanOrEqual(MIN_VISIBLE_ROWS);

  // 判据三：吸底操作条仍在视口内（它不能被"压缩"到看不见）。
  const startBar = await page.locator(".apply-queue-startbar").boundingBox();
  expect(startBar, "吸底操作条应渲染").not.toBeNull();
  expect(startBar!.y + startBar!.height).toBeLessThanOrEqual(768);

  // 判据四（#14 P2）：主 CTA「开始投递」不能被右下角的全局助手球压住。
  // 助手球贴视口右下、吸底条右缘跟内容区走，两者重叠与宽度无关（1366/1536/1920 都量过），
  // 所以这条在**任何**宽度都必须成立，不是 1366 专属的宽容。
  const cta = await page.locator(".apply-queue-startbar button.ant-btn-primary").boundingBox();
  const orb = await page.locator(".tt-shell").first().boundingBox();
  if (cta && orb) {
    expect(
      cta.x + cta.width,
      "「开始投递」右缘必须留在助手球左侧（≥4px 间隙）",
    ).toBeLessThanOrEqual(orb.x - 4);
  }
});
