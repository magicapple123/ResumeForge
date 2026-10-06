import { defineConfig } from "@playwright/test";

/**
 * 浏览器冒烟（QA 评审 P1-3）：jsdom 捕不到的 CSS / 构建产物 / 真实浏览器 API
 * 差异，由这几条用例在真实 Chromium 里兜住。
 *
 * 不配 webServer：应用的启动链归 CI 的 e2e 作业与本地 start 脚本管，这里只假定
 * 前后端已在目标端口活着（前端 SMOKE_FRONTEND_URL，默认 127.0.0.1:5199——与 CI
 * 干净检出 e2e 作业的端口一致；后端 SMOKE_BACKEND_URL，默认 8123）。
 */
export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.SMOKE_FRONTEND_URL ?? "http://127.0.0.1:5199",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
