// SPDX-License-Identifier: Apache-2.0
/**
 * 响应式硬指标（方案 §7.5 的 R1 / R2 / R3，进 CI）。
 *
 * 只判三条**可量化**的性质，不判"好不好看"：
 *   R1 文档与内容区都不横向溢出（> 1px 即失败）
 *   R2 没有"真丢了"的内容（被 hidden 裁掉且祖链上无可滚容器）
 *   R3 控件不重叠、不出屏幕
 *
 * **刻意不判 `squeeze`（单行 <4 字）**：QA 实测它在 8 个视口恒定 21–24 条，2560 与 1366
 * 同值——那是与分辨率无关的既有排版缺陷（方案 §1.9 的 I 类），把它写进 CI 会让门槛永远红。
 *
 * 跑法（需要 8123 上有打包同源服务）：
 *   npx playwright test -c playwright.responsive.config.ts
 */
import { expect, test } from "@playwright/test";
import { ROUTES, VIEWPORTS, collectMetrics } from "./helpers";

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route.path} 无横向溢出、无裁切、无重叠`, async ({ page }) => {
        // 等网络静下来：`domcontentloaded` 时列表还是骨架屏，量到的"窄容器"是加载态
        // 而不是布局缺陷（2026-10-23 的 profile 假阳性）。轮询型页面等不到 networkidle 时
        // 用超时兜底，继续按"主区已渲染"判。
        await page.goto(route.path, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
        await page.waitForSelector("main >> *", { timeout: 20_000 });
        await page.waitForTimeout(600);

        const metrics = await collectMetrics(page);

        expect(metrics.docOverflow, `文档横向溢出 ${metrics.docOverflow}px`).toBeLessThanOrEqual(1);
        expect(
          metrics.mainOverflow,
          `内容区横向溢出 ${metrics.mainOverflow}px`,
        ).toBeLessThanOrEqual(1);
        expect(metrics.clipped, "这些容器把内容裁掉了且滚不到").toEqual([]);
        expect(metrics.outOfViewport, "这些元素越出了视口").toEqual([]);
        expect(metrics.overlaps, "这些控件互相重叠").toEqual([]);
      });
    }
  });
}
