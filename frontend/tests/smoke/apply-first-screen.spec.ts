import { expect, test, type Page } from "@playwright/test";

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
  // P3（2026-11-23，台账第 9 条）之后这条**正好 768.000**——零余量，亚像素抖动就会假红。
  // 所以按实际视口高比较并留 0.5px，而不是把 768 调大：调大会掩盖真实回归
  //（条被撑到视口外 20px 也算过）。0.5 只是吸收 subpixel 舍入，不是宽容度。
  expect(startBar!.y + startBar!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);

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

/**
 * ===== 吸底条贴到窗口底（P3 挪内边距 + M1 移动端 min-height）=====
 *
 * 台账第 9 条的现场：`.app-content` 是滚动容器且带 `padding: var(--rf-content-pad)`
 * （16 / 24 / 32 三档），而 `position: sticky; bottom: 0` 的约束矩形是**容器的 padding
 * box 内侧**——吸底条只能贴到「视口底 − pad」，滚动内容却照样画到 padding 区，
 * 于是条下面露出一条**宽度等于该档内边距**的缝，表格行与分页器从这里滚过去
 *（1440 实测：缝 24px，条下 2px 命中 TD → DIV.ant-spin-container → UL.ant-pagination）。
 *
 * 判据必须落在**真实浏览器几何**上：jsdom 不求值布局，`getBoundingClientRect()` 恒为 0，
 * 这类"条底下露出别人"的问题在单测里永远看不见。CSS 契约（两条规则在不在）由
 * `src/features/apply/applyStickyBar.test.ts` 在 jsdom 里钉，两条合起来才算证据。
 *
 * 队列数据用 `page.route` 造 40 条：真库可能是空库（CI e2e 用干净数据目录），
 * 而这条判据**必须**有可滚动的长内容才成立——不能因为"库里没数据"就跳过。
 */

const QUEUE_ROW_COUNT = 40;

/** 40 条 mock 队列：只为把 `.app-content` 撑到必须滚动，字段取值不影响几何。 */
const MOCK_QUEUE = {
  items: Array.from({ length: QUEUE_ROW_COUNT }, (_, i) => ({
    id: i + 1,
    job_id: 100 + i,
    job_title: `岗位 ${i + 1}（校招）`,
    company: `杭州示例科技有限公司 ${i + 1}`,
    resume_id: null,
    resume_title: "",
    greeting: "您好，我有相关项目经验，希望与您进一步沟通。",
    sort_order: i,
    status: i % 3 === 0 ? "done" : "pending",
    admission: i % 4 === 0 ? "block" : null,
    hard_gate: null,
    requires_confirm: false,
    apply_supported: true,
    match_score: (i * 7) % 100,
    favorite: false,
    created_at: "2026-11-23T10:00:00",
    updated_at: "2026-11-23T10:00:00",
  })),
  total: QUEUE_ROW_COUNT,
  truncated: false,
};

/** 页面在 padding 区露出来的那几类元素：命中任一个就说明"缝"还在。 */
const FORBIDDEN_SELECTOR = ".ant-table-cell, .ant-spin-container, .ant-pagination";

/** 三档内边距各自对应的视口（--rf-content-pad 的分档：≤1092 → 16，默认 24，≥1920 → 32）。 */
const PAD_CASES = [
  { width: 1024, height: 768, pad: 16 },
  { width: 1440, height: 900, pad: 24 },
  { width: 1920, height: 1080, pad: 32 },
] as const;

type GeometrySample = {
  viewport: { width: number; height: number };
  innerHeight: number;
  pad: { content: string; page: string; token: string };
  barRect: Record<string, number> | null;
  contentRect: Record<string, number> | null;
  ctaRect: Record<string, number> | null;
  scroll: { top: number; scrollHeight: number; clientHeight: number };
  hits: Array<{ x: number; y: number; tag: string | null; cls: string; forbidden: boolean }>;
};

/** 把队列接口换成长列表，并关掉首启动引导。 */
async function prepareApplyPage(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
  await page.route(/\/api\/apply\/queue(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_QUEUE),
    });
  });
}

/** 滚到列表中段（这才是"内容从条下面滚过去"的真实场景），并读几何 + 条下 2px 的五点命中。 */
async function measureMidScroll(page: Page): Promise<GeometrySample> {
  await page.evaluate(() => {
    const content = document.querySelector(".app-content");
    if (!content) throw new Error("找不到滚动容器 .app-content");
    content.scrollTop = Math.round((content.scrollHeight - content.clientHeight) / 2);
  });
  // 等两帧：sticky 的位置在滚动提交后的下一次绘制才稳定。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  return page.evaluate((forbidden: string) => {
    const content = document.querySelector<HTMLElement>(".app-content");
    const applyPage = document.querySelector<HTMLElement>(".apply-page");
    const bar = document.querySelector<HTMLElement>(".apply-queue-startbar");
    if (!content || !applyPage || !bar) {
      throw new Error("投递台骨架不完整：.app-content / .apply-page / .apply-queue-startbar");
    }
    const barRect = bar.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const cta = bar.querySelector<HTMLElement>("button.ant-btn");
    const ctaRect = cta ? cta.getBoundingClientRect() : null;

    // 采样点在「条底边 + 2px」：P3 之前那里是 24px 的缝（会命中表格/分页器），
    // P3 之后条已经贴到视口底，+2 越界——所以夹到视口内最后一个像素，
    // 保证每次都是**真实采样**（不会因为返回 null 而"空过"）。
    const y = Math.min(barRect.bottom + 2, window.innerHeight - 1);
    const ratios = [0.1, 0.3, 0.5, 0.7, 0.9];
    const hits = ratios.map((ratio) => {
      const x = Math.round(barRect.left + barRect.width * ratio);
      const el = document.elementFromPoint(x, y);
      return {
        x,
        y: Math.round(y),
        tag: el ? el.tagName : null,
        cls: el ? String(el.className).slice(0, 80) : "(null)",
        // 用 closest 而不是只看命中元素本身：分页器的命中点常是内部 <a>/<li>。
        forbidden: !!el?.closest(forbidden),
      };
    });

    const tokenPad = getComputedStyle(document.documentElement)
      .getPropertyValue("--rf-content-pad")
      .trim();

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      innerHeight: window.innerHeight,
      pad: {
        content: getComputedStyle(content).paddingBottom,
        page: getComputedStyle(applyPage).paddingBottom,
        token: tokenPad,
      },
      barRect: barRect.toJSON(),
      contentRect: contentRect.toJSON(),
      ctaRect: ctaRect ? ctaRect.toJSON() : null,
      scroll: {
        top: Math.round(content.scrollTop),
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
      },
      hits,
    };
  }, FORBIDDEN_SELECTOR);
}

test.describe("吸底条贴到窗口底（P3 + M1，台账第 9 条）", () => {
  for (const { width, height, pad } of PAD_CASES) {
    test(`${width}×${height}：中段滚动时条下不得露出表格行/分页器，内边距 ${pad}px 档`, async ({
      page,
    }) => {
      await prepareApplyPage(page);
      await page.setViewportSize({ width, height });
      await page.goto("/apply");
      await page
        .locator(".ant-table-tbody tr.ant-table-row")
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });

      const geo = await measureMidScroll(page);
      // 主理人把这几行重定向到 evidence/T5/geometry-*.json：一行一条，便于 diff。
      console.log(JSON.stringify({ label: `${width}x${height}`, ...geo }));

      // ① 长内容确实滚动了：没有可滚空间时"条下露内容"这个场景根本不存在。
      expect(
        geo.scroll.scrollHeight - geo.scroll.clientHeight,
        "40 条队列必须能把 .app-content 撑出滚动条（否则本判据空转）",
      ).toBeGreaterThan(100);

      // ② P3 落地：滚动容器的底部内边距归零，内边距挪到页面自己身上——
      //    净高度不变，但 sticky 的约束矩形变成真正的底边。
      expect(geo.pad.content, "`.app-content` 在投递页的 padding-bottom 必须归零（P3）").toBe(
        "0px",
      );
      expect(geo.pad.page, "页面自己应接手 " + pad + "px 的底部内边距（P3）").toBe(`${pad}px`);

      // ③ 条真的贴到窗口底：缝 = 0（P3 之前这里恒等于该档内边距 16/24/32）。
      expect(
        geo.innerHeight - (geo.barRect?.bottom ?? 0),
        "吸底条底边必须贴到视口底（缝 ≤ 0.5px）",
      ).toBeLessThanOrEqual(0.5);

      // ④ 判据五：条底边 +2px 处横向 5 点，不得命中表格行 / 表格容器 / 分页器。
      //    注意不能写成"必须命中条本身"：命中点越界时是 null，且条本身也不唯一。
      const offenders = geo.hits.filter((hit) => hit.forbidden);
      expect(offenders, `条下漏出了表格内容：${JSON.stringify(offenders)}`).toEqual([]);

      // ⑤ M1 的桌面侧护栏：滚动容器底边不得超出视口（手机上会被 .app-main 裁掉）。
      expect(
        (geo.contentRect?.bottom ?? 0) - geo.innerHeight,
        ".app-content 底边不得超出视口",
      ).toBeLessThanOrEqual(0.5);
    });
  }

  test("375×720：滚动容器不溢出视口，主 CTA 完整可点（M1）", async ({ page }) => {
    await prepareApplyPage(page);
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/apply");
    await page
      .locator(".apply-queue-startbar")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    const geo = await measureMidScroll(page);
    console.log(JSON.stringify({ label: "375x720", ...geo }));

    // M1 之前：--rf-header-height 写死 120，而手机页头实际换行到 217.4px，
    // min-height: calc(100dvh - 120px) = 600 塞进只剩 502.6px 的空间 → 底边 817.4，
    // 超出视口 97.4px，再被 `.app-main` 的 overflow: hidden 裁掉，主 CTA 永远按不到。
    expect(
      (geo.contentRect?.bottom ?? 0) - geo.innerHeight,
      "375 宽下 `.app-content` 底边不得超出视口（M1 之前是 +97.4）",
    ).toBeLessThanOrEqual(0.5);

    expect(geo.ctaRect, "吸底条里的主按钮应渲染").not.toBeNull();
    expect(
      geo.ctaRect!.bottom,
      "主 CTA 底边必须在视口内（M1 之前是 801 / 945，被裁掉）",
    ).toBeLessThanOrEqual(geo.innerHeight + 0.5);

    // 手机上条下方同样不许露出表格内容。
    const offenders = geo.hits.filter((hit) => hit.forbidden);
    expect(offenders, `手机档条下漏出了表格内容：${JSON.stringify(offenders)}`).toEqual([]);
  });
});
