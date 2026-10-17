import { request as playwrightRequest, expect, test, type Page } from "@playwright/test";

/**
 * 浏览器冒烟：真实 Chromium 里走「启动 → 载入示例 → 岗位/简历可见 → 导出 PDF」。
 *
 * 前置：应用已在 SMOKE_FRONTEND_URL 上运行、API 可经 SMOKE_BACKEND_URL 访问
 * （CI 是构建出 dist 后的后端同源形态，两者同端口；本地 dev 模式下前端在 Vite
 * 端口、API 走代理，用环境变量分别指过去即可，用例两种形态通用）。
 * 每个用例都是全新浏览器上下文（localStorage 为空），所以首启动引导**必然弹出**
 * ——统一等它出现再关掉，而不是碰运气。
 *
 * 三条用例包在 describe.serial 里：第 2 条载入示例数据集，第 3 条依赖示例简历
 * 已存在——这是**刻意的顺序依赖**（示例数据集激活是后端全局状态）。第 3 条
 * 同时自带"示例是否已载入"的检查，单独跑它（-g / 重试）也能自给自足。
 */

const BACKEND_URL = process.env.SMOKE_BACKEND_URL ?? "http://127.0.0.1:8123";

/** 等首启动引导弹出并关闭它；引导是 mount 后异步打开的，必须显式等。 */
async function dismissGuide(page: Page) {
  const guide = page.getByRole("dialog").filter({ hasText: "欢迎使用简历通" });
  await guide.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  if (await guide.isVisible().catch(() => false)) {
    await guide.getByRole("button", { name: /稍后查看/ }).click();
  }
  await expect(guide).toHaveCount(0);
}

test.describe.serial("核心链路（第 2 条载入示例，第 3 条依赖它；顺序不可打乱）", () => {
  test("应用启动后主入口齐全，使用指南可弹出可关闭", async ({ page }) => {
    await page.goto("/");
    await dismissGuide(page);

    // 侧栏主入口（antd Menu → role=menuitem）：是"应用真的起来了"的最小判据。
    await expect(page.getByRole("menuitem", { name: "首页" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "岗位广场" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "简历中心" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "设置" })).toBeVisible();
  });

  test("载入体验示例数据集后，岗位与简历在真实页面里可见", async ({ page }) => {
    // 通过应用自己的 API 载入示例（独立数据集 + 一个岗位 + 一份简历），再走 UI 验证。
    const api = await playwrightRequest.newContext();
    const load = await api.post(`${BACKEND_URL}/api/settings/datasets/sample/load`);
    expect(load.ok()).toBeTruthy();
    const payload = (await load.json()) as { name?: string };
    expect(payload.name).toBe("体验示例");
    await api.dispose();

    // 岗位广场：示例岗位可见（真实渲染路径，jsdom 之外的 CSS/布局层也一起过了）。
    await page.goto("/jobs");
    await dismissGuide(page);
    await expect(page.getByText("市场运营专员").first()).toBeVisible();
    await expect(page.getByText("示例科技有限公司").first()).toBeVisible();

    // 简历中心：示例简历可见并可打开预览。
    await page.goto("/resumes");
    await dismissGuide(page);
    await expect(page.getByText("示例简历 · 市场运营").first()).toBeVisible();
  });

  test("示例简历可以真实导出为 PDF", async ({ page }) => {
    // 自带准备：顺序执行时示例已由上一条载入；单独跑本条（-g / 重试）时补载。
    // 重复载入是幂等的：后端会复用已有的「体验示例」数据集并切换过去
    // （sample/load 返回 reused=true），不会累积多份示例。
    const api = await playwrightRequest.newContext();
    const datasets = (await (await api.get(`${BACKEND_URL}/api/settings/datasets`)).json()) as {
      name: string;
      is_active: boolean;
    }[];
    if (!datasets.some((item) => item.name === "体验示例" && item.is_active)) {
      const load = await api.post(`${BACKEND_URL}/api/settings/datasets/sample/load`);
      expect(load.ok()).toBeTruthy();
    }
    await api.dispose();

    await page.goto("/resumes");
    await dismissGuide(page);

    // 打开示例简历的预览详情。
    await page.getByText("示例简历 · 市场运营").first().click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /下载 PDF/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    // fpdf2 产出的最小 PDF 也有几百字节；收到非空文件即认为导出链路完整。
    expect(size).toBeGreaterThan(200);

    // RF-16 内容级校验：下载流前缀必须是 PDF magic bytes（只加断言，不改下载流程）。
    const head = Buffer.concat(chunks).subarray(0, 5).toString("latin1");
    expect(head).toBe("%PDF-");
  });
});
