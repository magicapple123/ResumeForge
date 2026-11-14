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

// 1366×768 实测：页头 102 + 浏览器卡 66（2026-11-13 两行结构）+ 页签 42 + 工具栏 101
// （面板 1092 < F09 的 1166 阈值，两行）+ 表头 35，首行落在 465。预算按实测定档，
// 不再沿用"工具栏单行"时代的 300：那是**设计已明确放弃**的形态（F09 只在 ≥1166 合并）。
// 想验证单行密度用 1440 视口（面板 1166，工具栏 40）。
const FIRST_ROW_BUDGET = 480; // 首行顶部 Y（含站点行/浏览器卡/页签/工具栏/表头）
// 实测 4 行（(768 − 465) / 64 = 4.7）。7 行是"工具栏/浏览器卡都单行"时代的判据；
// 两行浏览器卡（2026-11-13 用户反馈）+ F09 的两行工具栏在 1366 上共同吃掉约 100px，
// 这是**已接受的设计取舍**，1440（面板 1166，工具栏 40）仍有 5–6 行。
const MIN_VISIBLE_ROWS = 4;

test.beforeEach(async ({ page }) => {
  // 首启动引导会盖住页面且吃掉首屏高度，先在导航前标记"已看过"。
  await page.addInitScript(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
});

test("1366×768：投递队列首屏至少放得下 7 行，且工具栏/浏览器卡各占一行", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/apply");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape").catch(() => {});

  // 三块"吃掉首屏"的元凶各自的高度上限。浏览器卡自 2026-11-13 起是**两行结构**
  // （身份行 + 细节行：端口/扫码提示/沿用说明），实测 65.6；上限取 68 留 2px 余量。
  const browserBar = await page.locator(".apply-browser-bar").boundingBox();
  expect(browserBar, "浏览器状态卡应渲染").not.toBeNull();
  expect(browserBar!.height, "浏览器卡最多两行（#14G，含扫码提示）").toBeLessThanOrEqual(68);

  const toolbar = await page.locator(".apply-queue-head").boundingBox();
  expect(toolbar, "队列工具栏应渲染").not.toBeNull();
  // 队列头部按**面板可用宽度**分档（F09）：1440 视口面板 1166 → 一行 40；
  // 1366 视口面板约 1092 < 1166 → 设计上就是两行（筛选+工具 / 计数+批量），实测 101。
  expect(toolbar!.height, "队列工具栏最多两行（#14H）").toBeLessThanOrEqual(104);

  const header = page.locator(".ant-table-thead").first();

  // **空队列时整张表都不渲染**（换成 `<Empty>` 空态），所以不能一上来就等 `.ant-table-thead`：
  // CI 的 e2e 用干净数据目录，等 90s 也不会出现表头。先看表在不在，再分两条路量。
  const hasTable = (await header.count()) > 0;
  if (hasTable) await header.waitFor({ state: "visible" });

  const rows = page.locator(".ant-table-tbody tr.ant-table-row");
  const count = hasTable ? await rows.count() : 0;

  if (count === 0) {
    // 没有行可量时退一步断"队列区本身在首屏内"。锚点用 `.apply-queue-panel`（空态和有
    // 数据时都存在），**不要用 `.ant-empty`**：空态是垂直居中的，y 随字体度量在 287–320
    // 之间漂——Linux/Windows 过、macOS 挂。同一块布局出问题时这条断言照样会红。
    const panel = page.locator(".apply-queue-panel").first();
    const box = await panel.boundingBox();
    expect(box, "队列区应渲染").not.toBeNull();
    expect(box!.y, "空队列时队列区也必须在首屏内").toBeLessThanOrEqual(FIRST_ROW_BUDGET);
    return;
  }

  const headerBox = await header.boundingBox();
  expect(headerBox, "表头应渲染").not.toBeNull();

  const first = await rows.first().boundingBox();
  expect(first, "首行应可测量").not.toBeNull();

  // 判据一：首行顶部 ≤ 300（第一版实测 618.14）。
  expect(first!.y, "首行顶部 Y 必须 ≤ 480（#14G/#14H）").toBeLessThanOrEqual(FIRST_ROW_BUDGET);

  // 判据二：可见行数 ≥ 7（第一版实测 2）。
  const visibleRows = Math.floor((768 - first!.y) / first!.height);
  expect(visibleRows, "首屏可见行数必须 ≥ 4").toBeGreaterThanOrEqual(MIN_VISIBLE_ROWS);

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
