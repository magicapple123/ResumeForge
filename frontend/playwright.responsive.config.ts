import { defineConfig, devices } from "@playwright/test";

/**
 * 响应式硬指标门槛（方案 §7.7 / T16）。
 *
 * 为什么**另起一份配置**而不是塞进 `playwright.config.ts`：默认配置的 `testDir` 是
 * `./tests/smoke`，那套用例的断言是在 1200px 下校准的。把 8 视口矩阵塞进去，页面加载次数
 * 会从 18 路由 × 3 视口 = 54 涨到 18 × 8 = 144，"冒烟"这个词就失去意义了。
 *
 * 跑法：`npx playwright test -c playwright.responsive.config.ts`
 * 依赖一个已经在跑的同源服务（CI 里是打包态 8123，方案附录 D5）。
 */
export default defineConfig({
  testDir: "./tests/responsive",
  // 144 次导航，串行更稳：并行会让 4 个 Chromium 抢同一台机器的内存，反而偶发超时。
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.SMOKE_FRONTEND_URL ?? "http://127.0.0.1:8123",
    // 指标口径统一 DPR 1：DPR 只影响位图密度，不影响布局；混着用会让像素数对不上。
    deviceScaleFactor: 1,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
