import { defineConfig } from "@playwright/test";

/**
 * 浏览器冒烟（QA 评审 P1-3）：jsdom 捕不到的 CSS / 构建产物 / 真实浏览器 API
 * 差异，由这几条用例在真实 Chromium 里兜住。
 *
 * 不配 webServer：应用的启动链归 CI 的 e2e 作业与本地 start 脚本管，这里只假定
 * 应用已在目标地址活着。RF-09 方案 A 之后的主场景是**后端同源静态**（发布包自带
 * frontend/dist，页面与 API 都在后端端口上，默认 http://127.0.0.1:8123——与 CI
 * 干净检出 e2e 作业一致）；本地以 dev 模式排查时用 SMOKE_FRONTEND_URL 指到
 * Vite 的地址（如 http://127.0.0.1:5173）即可，用例本身两种形态通用。
 */
export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.SMOKE_FRONTEND_URL ?? "http://127.0.0.1:8123",
    // 语言钉在中文：首启语言跟随系统（`readInitialLocale` 的兜底分支读 `navigator.languages`），
    // 而 CI 运行器是英文环境——不钉的话断言的中文文案（菜单 / 首屏 / 首次引导标题）在
    // Linux、macOS、Windows 三个 runner 上同时失配，看起来像"页面没渲染"。
    // 这些用例的断言本来就是按中文写死的，钉住 locale 是让环境确定，不是放宽断言。
    locale: "zh-CN",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
