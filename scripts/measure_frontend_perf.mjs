/**
 * RF-09 前端性能对照测量脚本（只测量，不修改任何业务代码；不进 tests/、不进 CI）。
 *
 * 用途
 * ====
 * 对「生产资产（vite preview）」与「dev server」做同机、同浏览器、冷浏览器缓存
 * 的首屏对照：HomePage 与 TrackerPage 各测量 DOMContentLoaded / Load / LCP
 * （最大内容绘制近似）/ 资源请求数与传输字节，各跑 N 次取中位数。
 *
 * 方法口径
 * ========
 * - 冷缓存：每个 run 使用全新的 browser context（隔离的磁盘缓存/存储）。
 * - 后端 API：用 Playwright 路由拦截全部 /api/ 请求并回放固定 JSON mock——两套服务
 *   拿到**完全相同**的数据，把"资产加载与渲染成本"从"后端数据差异"里隔离出来。
 *   mock 形状按后端 schema 造（Stats / TrackListOut / Page[...]），数量级与
 *   后端 fixture 对齐（tracker 列表 500 条 / 分页 20 条）。
 * - 每个「目标 × 路由」先做一次**不计入**的热身导航（dev server 的首访包含
 *   按需 transform，不属于"浏览器冷缓存"要测的东西），然后跑 --runs 次。
 * - LCP 用 PerformanceObserver('largest-contentful-paint', buffered) 取最后一个条目。
 *
 * 运行方式（仓库根目录，需先各自起好两个服务）::
 *
 *     cd frontend && npx vite preview --outDir <构建目录> --port 4199 --strictPort
 *     cd frontend && npx vite --port 5199 --strictPort
 *     node scripts/measure_frontend_perf.mjs \
 *       --prod http://localhost:4199 --dev http://localhost:5199 \
 *       --routes /,/tracker --runs 3 --out /d/rf_build_tmp/rf09_fe_perf.json
 *
 * 浏览器：优先 playwright 自带 chromium；不可用时依次回退 msedge / chrome
 * 系统频道。若都不可用，脚本明确报错退出，**不硬凑数字**。
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "..", "frontend");
const require = createRequire(pathToFileURL(path.join(FRONTEND_DIR, "package.json")));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const options = {
    prod: process.env.RF09_PROD_URL || "",
    dev: process.env.RF09_DEV_URL || "",
    routes: ["/", "/tracker"],
    runs: 3,
    out: path.join(path.dirname(fileURLToPath(new URL(".", import.meta.url).href)), "rf09_fe_perf.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") options.prod = argv[++i];
    else if (arg === "--dev") options.dev = argv[++i];
    else if (arg === "--routes") options.routes = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--runs") options.runs = Number(argv[++i]);
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "用法: node scripts/measure_frontend_perf.mjs [选项]",
          "",
          "选项:",
          "  --prod <url>    生产资产服务地址（vite preview）",
          "  --dev <url>     dev server 地址（vite）",
          "  --routes <a,b>  要测量的路由，逗号分隔（默认 /,/tracker）",
          "  --runs <n>      每个「目标 × 路由」的采样次数（默认 3，取中位数）",
          "  --out <path>    结果 JSON 输出路径",
          "",
          "输出表列说明: dcl=DOMContentLoaded(ms), load=Load(ms), lcp=最大内容绘制(ms),",
          "req=资源请求数, bytes=传输字节（performance resource entries 之和）。",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  if (!options.prod && !options.dev) {
    console.error("需要至少提供 --prod 或 --dev 之一");
    process.exit(1);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// API mock：形状对齐后端 schema（schemas/search.py::Stats、schemas/tracker.py::TrackListOut）。
// ---------------------------------------------------------------------------
const TRACK_STATUSES = ["applied", "screening", "assessment", "interview", "offer", "rejected"];
const COMPANIES = ["星河科技", "云帆网络", "深蓝智能", "远航数据", "临港软件", "青崖信息"];
const TITLES = ["后端开发工程师", "前端开发工程师", "测试开发工程师", "数据分析师", "算法工程师"];

function iso(offsetDays) {
  const base = new Date("2026-10-10T09:00:00Z").getTime();
  return new Date(base - offsetDays * 86400000).toISOString();
}

function makeTrack(id) {
  return {
    id,
    company: COMPANIES[id % COMPANIES.length],
    title: `${TITLES[id % TITLES.length]}（进度${id}）`,
    status: TRACK_STATUSES[id % TRACK_STATUSES.length],
    stage_note: id % 3 === 0 ? "一面" : "",
    applied_at: "2026-09-15",
    status_date: "2026-10-02",
    next_action: "等待面试反馈",
    next_action_date: "",
    note: `第${id}条进度记录备注`.repeat(5),
    evidence: `来自第${id}封通知的摘录`,
    job_id: (id % 100) + 1,
    source: "manual",
    created_at: iso(id % 30),
    updated_at: iso(id % 10),
  };
}

function makeJob(id) {
  return {
    id,
    title: `${TITLES[id % TITLES.length]}（fixture${id}）`,
    company: COMPANIES[id % COMPANIES.length],
    location: "上海",
    salary: "25k",
    job_type: "校招",
    status: "开放中",
    favorite: id % 17 === 0,
    created_at: iso(id % 30),
    updated_at: iso(id % 10),
  };
}

function makeResumeBrief(id) {
  return {
    id,
    title: `测试简历-${id}`,
    job_id: (id % 100) + 1,
    job_title: TITLES[id % TITLES.length],
    company: COMPANIES[id % COMPANIES.length],
    source: id % 2 ? "ai" : "manual",
    favorite: false,
    model: id % 2 ? "fixture-model" : "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    note: "",
  };
}

const TRACK_ITEMS = Array.from({ length: 500 }, (_, i) => makeTrack(i + 1));
const JOB_ITEMS = Array.from({ length: 100 }, (_, i) => makeJob(i + 1));
const RESUME_ITEMS = Array.from({ length: 100 }, (_, i) => makeResumeBrief(i + 1));

const STATS = {
  job_count: 10000,
  open_job_count: 8000,
  resume_count: 2000,
  week_resume_count: 30,
  latest_jobs: JOB_ITEMS.slice(0, 5),
  latest_resumes: RESUME_ITEMS.slice(0, 5),
  favorite_job_count: 12,
  pending_claim_count: 8,
  pending_claims: [],
  stalled_application_count: 20,
  apply_queue_count: 10,
  latest_applications: [],
};

const TRACK_LIST = {
  items: TRACK_ITEMS,
  total: 500,
  status_counts: { applied: 100, screening: 100, assessment: 100, interview: 100, offer: 50, rejected: 50, unknown: 0 },
  active_count: 400,
  offer_count: 50,
  rejected_count: 50,
  month_count: 120,
};

const TRACK_PAGE = { items: TRACK_ITEMS.slice(0, 20), total: 500 };
const JOBS_PAGE = { items: JOB_ITEMS, total: 10000 };
const RESUMES_PAGE = { items: RESUME_ITEMS, total: 2000 };
const EMPTY_PAGE = { items: [], total: 0 };

function mockJson(url) {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/api/stats") return STATS;
  if (p === "/api/tracker") return TRACK_LIST;
  if (p.startsWith("/api/tracker/page")) return TRACK_PAGE;
  if (p.startsWith("/api/jobs")) return JOBS_PAGE;
  if (p.startsWith("/api/resumes")) return RESUMES_PAGE;
  if (p.startsWith("/api/reminders")) return [];
  if (p.startsWith("/api/search")) return { jobs: [], resumes: [], tracks: [], claims: [], knowledge: [] };
  if (p.startsWith("/api/candidate-jobs/page")) return EMPTY_PAGE;
  if (p.startsWith("/api/settings")) return {};
  return EMPTY_PAGE;
}

async function installApiMock(context) {
  // 只按「路径以 /api/ 开头」判断：不能用 "**/api/**" 这类 glob——它会把
  // 前端自己的源码模块（/src/api/*.ts）也拦下来，dev 模式下整个应用无法启动。
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        return route.fulfill({ status: 405, contentType: "application/json", body: '{"detail":"mock"}' });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockJson(request.url())),
      });
    },
  );
}

// ---------------------------------------------------------------------------
// 浏览器启动：playwright chromium → msedge → chrome，逐级回退。
// ---------------------------------------------------------------------------
async function launchBrowser() {
  const { chromium } = require("playwright");
  const attempts = [{}, { channel: "msedge" }, { channel: "chrome" }];
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...attempt });
    } catch (error) {
      errors.push(`${attempt.channel || "bundled-chromium"}: ${error.message.split("\n")[0]}`);
    }
  }
  throw new Error(`没有任何可用的浏览器（尝试顺序: bundled → msedge → chrome）:\n${errors.join("\n")}`);
}

// ---------------------------------------------------------------------------
// 单次测量
// ---------------------------------------------------------------------------
async function measureOnce(browser, baseUrl, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installApiMock(context);
  const page = await context.newPage();
  // LCP 观察器在文档创建前注入：buffered 保证错过早期条目也能取到。
  await page.addInitScript(`
    window.__lcp = 0;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__lcp = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) { /* 老内核不支持就算了 */ }
  `);
  const url = baseUrl.replace(/\/$/, "") + route;
  const result = { url };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    // 再等一帧让 LCP 收敛。
    await page.waitForTimeout(300);
    const nav = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] || {};
      const resources = performance.getEntriesByType("resource");
      return {
        domContentLoaded: entry.domContentLoadedEventEnd || 0,
        load: entry.loadEventEnd || 0,
        transferBytes: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
        requestCount: resources.length,
      };
    });
    result.domContentLoadedMs = Math.round(nav.domContentLoaded);
    result.loadMs = Math.round(nav.load);
    result.lcpMs = Math.round((await page.evaluate(() => window.__lcp)) || 0);
    result.transferBytes = nav.transferBytes;
    result.requestCount = nav.requestCount;
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = error.message.split("\n")[0];
  } finally {
    await context.close();
  }
  return result;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

async function measureTarget(browser, name, baseUrl) {
  console.log(`\n=== 目标: ${name} (${baseUrl}) ===`);
  const rows = [];
  for (const route of options.routes) {
    // 热身导航不计入：dev server 首访包含按需 transform，不属于浏览器冷缓存。
    await measureOnce(browser, baseUrl, route);
    const runs = [];
    for (let i = 0; i < options.runs; i++) {
      const result = await measureOnce(browser, baseUrl, route);
      runs.push(result);
      if (!result.ok) {
        console.log(`  ${route} run${i + 1} 失败: ${result.error}`);
      }
    }
    const okRuns = runs.filter((r) => r.ok);
    if (!okRuns.length) {
      rows.push({ route, ok: false });
      continue;
    }
    const summary = {
      route,
      ok: true,
      runs: okRuns.length,
      dclMedianMs: Math.round(median(okRuns.map((r) => r.domContentLoadedMs))),
      loadMedianMs: Math.round(median(okRuns.map((r) => r.loadMs))),
      lcpMedianMs: Math.round(median(okRuns.map((r) => r.lcpMs))),
      bytesMedian: median(okRuns.map((r) => r.transferBytes)),
      requestsMedian: Math.round(median(okRuns.map((r) => r.requestCount))),
      raw: okRuns,
    };
    rows.push(summary);
    console.log(
      `  ${route}  dcl=${summary.dclMedianMs}ms  load=${summary.loadMedianMs}ms  ` +
        `lcp=${summary.lcpMedianMs}ms  req=${summary.requestsMedian}  ` +
        `bytes=${fmtBytes(summary.bytesMedian)}  (n=${summary.runs})`,
    );
  }
  return rows;
}

async function main() {
  const browser = await launchBrowser();
  const output = { generatedAt: new Date().toISOString(), runs: options.runs, routes: options.routes, targets: {} };
  try {
    if (options.prod) output.targets.prod = await measureTarget(browser, "prod(vite preview)", options.prod);
    if (options.dev) output.targets.dev = await measureTarget(browser, "dev(vite)", options.dev);
  } finally {
    await browser.close();
  }
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(output, null, 2));
  console.log(`\n结果 JSON 已写入: ${options.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
