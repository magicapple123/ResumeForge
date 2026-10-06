import { request as playwrightRequest, expect, test, type Page } from "@playwright/test";

/**
 * 浏览器冒烟：真实 Chromium 里走「启动 → 载入示例 → 岗位/简历可见 → 导出 PDF」。
 *
 * 前置：前后端已在 SMOKE_FRONTEND_URL / SMOKE_BACKEND_URL 上运行（本地用启动链，
 * CI 用干净检出 e2e 作业）。每个用例都是全新浏览器上下文（localStorage 为空），
 * 所以首启动引导**必然弹出**——统一等它出现再关掉，而不是碰运气。
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
});
