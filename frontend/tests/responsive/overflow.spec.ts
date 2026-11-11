// SPDX-License-Identifier: Apache-2.0
/**
 * 响应式硬指标（方案 §7.5 的 R1 / R2 / R3，进 CI）。
 *
 * 只判**可量化**的性质，不判"好不好看"：
 *   R1 文档与内容区都不横向溢出（> 1px 即失败）
 *   R2 没有"真丢了"的内容（被 hidden 裁掉且祖链上无可滚容器）
 *   R3 控件不重叠、不出屏幕
 *   R4-a 双栏档（≥1093）`.app-content` 纵向溢出 ≤1px（"只能滚 1px"就是这条守的）
 *   R4-b 不存在"声明式 scroll 却装得下"的空滚动条
 *   R4-c `/assistant` 的消息区 ≥240px（320 下限被压缩时不能压到看不见）
 *
 * R4 的阈值口径：R4-a 判 1px 而不是 0——亚像素舍入（DPR 1 下 0.4px）不该让 CI 常年红；
 * R4-c 判 240 而不是 320，因为 320 只在 `min-height:700px` 的视口生效，短视口要靠内容决定。
 *
 * **刻意不判 `squeeze`（单行 <4 字）**：QA 实测它在 8 个视口恒定 21–24 条，2560 与 1366
 * 同值——那是与分辨率无关的既有排版缺陷（方案 §1.9 的 I 类），把它写进 CI 会让门槛永远红。
 *
 * 跑法（需要 8123 上有打包同源服务）：
 *   npx playwright test -c playwright.responsive.config.ts
 */
import { expect, test } from "@playwright/test";
import { ROUTES, VIEWPORTS, collectMetrics, collectVertical } from "./helpers";

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

        // ---- R4 纵向（#2）----
        const vertical = await collectVertical(page);

        const declared = "fitsViewport" in route && route.fitsViewport === true;
        if (viewport.width >= 1093 && declared) {
          // R4-a 声明式：只有声明"必须装进一屏"的路由才判。消息给到 px + 路由，
          // 因为这条最容易在"改了高度链路某一段"时被无声破坏。
          expect(
            vertical.contentOverflow,
            `${route.path} 在 ${viewport.width}×${viewport.height} 下 .app-content 纵向溢出 ${vertical.contentOverflow}px`,
          ).toBeLessThanOrEqual(1);
        }

        // R4-b：`overflow: scroll` 且 scrollHeight === clientHeight = 用户看到一条
        // 拖不动的滚动条（2026-11 助手页那条只能滚 1px 的就是它的近亲）。
        expect(
          vertical.emptyScrollbars,
          `${route.path} 存在空滚动条（声明 scroll 但装得下）`,
        ).toEqual([]);

        // R4-c：`/assistant` 的消息区不能被压没。
        if (route.path === "/assistant") {
          expect(
            vertical.assistantMessagesHeight,
            `${route.path} 在 ${viewport.width}×${viewport.height} 下消息区只有 ${vertical.assistantMessagesHeight}px`,
          ).toBeGreaterThanOrEqual(240);
        }
      });
    }
  });
}
