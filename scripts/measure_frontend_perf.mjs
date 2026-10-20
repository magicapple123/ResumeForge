// SPDX-License-Identifier: Apache-2.0
/**
 * RF-09 前端性能对照测量脚本（PR-17 fail-closed 重构版；不修改任何业务代码）。
 *
 * 用途
 * ====
 * 对「生产资产（vite preview）」与「dev server」做同机、同浏览器、冷浏览器缓存
 * 的首屏对照：HomePage 与 TrackerPage 各测量 DOMContentLoaded / Load / LCP
 * （最大内容绘制近似）/ 资源请求数与传输字节，各跑 N 次取中位数。
 *
 * PR-17 修复（为什么旧数字不可信）
 * ========
 * 1. **mock 覆盖补齐**：旧 mock 没覆盖 /api/tracker/stats（P1-2 新端点）、
 *    /api/reminders/upcoming、/api/settings/navigation 等应用壳端点。
 * 2. **未匹配请求显式失败**：旧 mock 对一切未匹配的 /api/ 请求默认回
 *    EMPTY_PAGE——错误 schema（甚至完全不相关的路径）都能被伪装成"成功渲染"，
 *    出现空页也可能得到好看的 LCP。现在未匹配请求会收到
 *    ``{"detail":"unmatched by perf mock (fail-closed)"}`` 的 500，并且**计入
 *    unmatched 计数**，任何一次 run 只要 unmatched > 0 就判失败。
 * 3. **业务断言先于指标**：每次 run 结束后断言
 *      - 关键业务元素存在（mock 数据里的公司名/统计数字真的渲染进了 DOM）；
 *      - 列表/卡片类元素行数 > 0；
 *      - pageerror 为零；
 *      - 未命中 mock 计数为零。
 *    全部通过后才记录 LCP 等指标；失败 run 不进中位数，原因逐条打印。
 * 4. mock 形状对齐后端 schema（backend/app/schemas/search.py::Stats、
 *    schemas/tracker.py::TrackStatsOut / Page[TrackOut]、schemas/reminder.py、
 *    schemas/setting.py），不凭记忆编字段。
 *
 * 方法口径
 * ========
 * - 冷缓存：每个 run 使用全新的 browser context（隔离的磁盘缓存/存储）。
 * - 后端 API：用 Playwright 路由拦截全部 /api/ 请求并回放固定 JSON mock——两套
 *   服务拿到**完全相同**的数据，把"资产加载与渲染成本"从"后端数据差异"里隔离出来。
 * - 每个「目标 × 路由」先做一次**不计入**的热身导航，然后跑 --runs 次。
 * - LCP 用 PerformanceObserver('largest-contentful-paint', buffered) 取最后一个条目。
 *
 * 运行方式（仓库根目录，需先各自起好两个服务；端口用临时高位端口）::
 *
 *     cd frontend && npx vite preview --outDir <仓库外构建目录> --port 18401 --strictPort
 *     cd frontend && npx vite --port 18402 --strictPort
 *     node scripts/measure_frontend_perf.mjs \
 *       --prod http://localhost:18401 --dev http://localhost:18402 \
 *       --routes /,/tracker --runs 3 --out <仓库外>/rf09_fe_perf.json
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
// API mock：形状对齐后端 schema（schemas/search.py::Stats、
// schemas/tracker.py::TrackStatsOut / Page[TrackOut]、schemas/reminder.py、
// schemas/setting.py）。全部导出供 node:test 契约测试使用。
// ---------------------------------------------------------------------------
export const TRACK_STATUSES = ["applied", "screening", "assessment", "interview", "offer", "rejected"];
export const COMPANIES = ["星河科技", "云帆网络", "深蓝智能", "远航数据", "临港软件", "青崖信息"];
export const TITLES = ["后端开发工程师", "前端开发工程师", "测试开发工程师", "数据分析师", "算法工程师"];

function iso(offsetDays) {
  const base = new Date("2026-10-10T09:00:00Z").getTime();
  return new Date(base - offsetDays * 86400000).toISOString();
}

export function makeTrack(id) {
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
    resume_id: null,
    channel: "manual",
    source: "manual",
    created_at: iso(id % 30),
    updated_at: iso(id % 10),
  };
}

export function makeJob(id) {
  return {
    id,
    title: `${TITLES[id % TITLES.length]}（fixture${id}）`,
    company: COMPANIES[id % COMPANIES.length],
    location: "上海",
    salary: "25k·13薪",
    job_type: "校招",
    description: "这是 mock fixture 的虚构岗位描述。",
    requirements: "本科及以上学历。",
    additional_info: "五险一金。",
    note: "",
    note_images: [],
    keywords: [{ name: "Python", category: "编程语言" }],
    status: "开放中",
    source: "手动添加",
    source_url: "",
    favorite: id % 17 === 0,
    recognition_source: null,
    created_at: iso(id % 30),
    updated_at: iso(id % 10),
  };
}

export function makeResumeBrief(id) {
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

// schemas/search.py::Stats（含 claim_count / resume_with_job_count 新口径）。
export const STATS = {
  job_count: 10000,
  open_job_count: 8000,
  resume_count: 2000,
  week_resume_count: 30,
  latest_jobs: JOB_ITEMS.slice(0, 5),
  latest_resumes: RESUME_ITEMS.slice(0, 5),
  favorite_job_count: 12,
  pending_claim_count: 8,
  pending_claims: [{ id: 1, title: "虚构事实条目1" }],
  stalled_application_count: 20,
  apply_queue_count: 10,
  claim_count: 40,
  resume_with_job_count: 1500,
  latest_applications: [],
};

// schemas/tracker.py::TrackStatsOut（P1-2 独立统计端点）。
export const TRACK_STATS = {
  total: 500,
  status_counts: { applied: 100, screening: 100, assessment: 100, interview: 100, offer: 50, rejected: 50 },
  active_count: 400,
  offer_count: 50,
  rejected_count: 50,
  month_count: 120,
};

// schemas/tracker.py::TrackListOut（旧全量端点，前端历史路径仍会请求）。
export const TRACK_LIST = {
  items: TRACK_ITEMS,
  total: 500,
  status_counts: TRACK_STATS.status_counts,
  active_count: 400,
  offer_count: 50,
  rejected_count: 50,
  month_count: 120,
};

// schemas/common.py::Page[T]。
export const TRACK_PAGE = { items: TRACK_ITEMS.slice(0, 20), total: 500 };
export const JOBS_PAGE = { items: JOB_ITEMS.slice(0, 20), total: 10000 };
export const RESUMES_PAGE = { items: RESUME_ITEMS.slice(0, 20), total: 2000 };
export const EMPTY_PAGE = { items: [], total: 0 };

// schemas/reminder.py::ReminderUpcomingOut[]（首页待办提醒；空数组即合法回显）。
export const UPCOMING_REMINDERS = [];

// schemas/setting.py 的应用壳设置（useNavigationVisibility / 提醒弹窗 / 悬浮球）。
export const NAVIGATION_VISIBILITY = { hidden: [] };
export const REMINDER_POPUP = { enabled: false };
export const ASSISTANT_ORB = { enabled: false, tips_enabled: false };
export const APPLY_QUEUE = [];

/**
 * 未匹配请求的 fail-closed 回复体：任何 /api/ 请求只要 mock 清单没有点名，
 * 都拿到这个 500——错误在页面上可见（ErrorBoundary/空态报错），绝不再用
 * EMPTY_PAGE 伪装成功。
 */
export const UNMATCHED_DETAIL = "unmatched by perf mock (fail-closed)";

/**
 * 把 URL 解析成 mock 名称；未覆盖的路径返回 null（由调用方 fail-closed）。
 * 只按 pathname 前缀匹配，忽略 query；顺序敏感：/tracker/page、/tracker/stats
 * 必须排在 /tracker 之前（同 FastAPI 字面量段优先的规则）。
 */
export function classifyMockRequest(url) {
  const p = new URL(url, "http://mock.local").pathname;
  if (p === "/api/dataset-scope") return "dataset_scope";
  if (p === "/api/stats") return "stats";
  if (p === "/api/tracker/stats") return "tracker_stats";
  if (p.startsWith("/api/tracker/page")) return "tracker_page";
  if (p === "/api/tracker") return "tracker_list";
  if (p === "/api/jobs" || p.startsWith("/api/jobs/")) return "jobs";
  if (p.startsWith("/api/resumes")) return "resumes";
  if (p.startsWith("/api/reminders/upcoming")) return "reminders_upcoming";
  if (p.startsWith("/api/reminders")) return "reminders";
  if (p.startsWith("/api/candidate-jobs/page")) return "candidate_jobs_page";
  if (p.startsWith("/api/knowledge/page")) return "knowledge_page";
  if (p.startsWith("/api/knowledge")) return "knowledge";
  if (p.startsWith("/api/search")) return "search";
  if (p === "/api/settings/navigation") return "settings_navigation";
  if (p.startsWith("/api/settings/reminder-popup")) return "settings_reminder_popup";
  if (p.startsWith("/api/settings/assistant-orb")) return "settings_assistant_orb";
  if (p.startsWith("/api/settings")) return "settings_llm";
  if (p.startsWith("/api/apply/queue")) return "apply_queue";
  if (p.startsWith("/api/analytics/dashboard")) return "analytics_dashboard";
  return null;
}

/** mock 响应体（已按名称对齐真实 DTO）。未匹配返回 undefined。 */
export function mockBodyFor(name) {
  switch (name) {
    case "dataset_scope":
      return { scope: "perf-fixture:main:1", dataset_id: "main", generation: 1 };
    case "stats":
      return STATS;
    case "tracker_stats":
      return TRACK_STATS;
    case "tracker_page":
      return TRACK_PAGE;
    case "tracker_list":
      return TRACK_LIST;
    case "jobs":
      return JOBS_PAGE;
    case "resumes":
      return RESUMES_PAGE;
    case "reminders_upcoming":
      return UPCOMING_REMINDERS;
    case "reminders":
      return [];
    case "candidate_jobs_page":
      return EMPTY_PAGE;
    case "knowledge_page":
      return EMPTY_PAGE;
    case "knowledge":
      return [];
    case "search":
      return { jobs: [], resumes: [], tracks: [], claims: [], knowledge: [], more: [] };
    case "settings_navigation":
      return NAVIGATION_VISIBILITY;
    case "settings_reminder_popup":
      return REMINDER_POPUP;
    case "settings_assistant_orb":
      return ASSISTANT_ORB;
    case "settings_llm":
      return {};
    case "apply_queue":
      return APPLY_QUEUE;
    case "analytics_dashboard":
      return {};
    default:
      return undefined;
  }
}

/**
 * fail-closed 的 mock 决策：返回 { matched, status, name, body }。
 * 未匹配 → matched=false + 500；非 GET → 405（测量只回放 GET 语义）。
 */
export function mockResponseFor(url, method = "GET") {
  const name = classifyMockRequest(url);
  if (name === null) {
    return { matched: false, status: 500, name: null, body: { detail: UNMATCHED_DETAIL } };
  }
  if (method !== "GET") {
    return { matched: true, status: 405, name, body: { detail: "perf mock only replays GET" } };
  }
  return { matched: true, status: 200, name, body: mockBodyFor(name) };
}

/** mock 状态容器：记录未匹配请求，供 run 结束后的 fail-closed 断言。 */
export function createMockState() {
  return { unmatched: [] };
}

/** 每条业务路由的"渲染到位"证据口径：mock 数据里的文本必须出现在 DOM。 */
export const ROUTE_EVIDENCE = {
  "/": {
    // 统计数字（job_count=10000）与最新岗位/简历标题（latest_jobs[0].title）。
    requiredTexts: ["10000", "后端开发工程师（fixture1）", "测试简历-2"],
    minRowishElements: 1,
  },
  "/tracker": {
    // 进度列表的公司名与状态文案；TRACK_STATS 的数字也要渲染（漏斗）。
    requiredTexts: ["星河科技", "已投递", "400"],
    minRowishElements: 1,
  },
};

/**
 * 纯函数：判定一次 run 的渲染证据是否达标。evidence 由
 * collectRenderEvidence(page) 在浏览器里采集，这里只做判定（node:test 可测）。
 */
export function assertRenderEvidence(route, evidence) {
  const reasons = [];
  const config = ROUTE_EVIDENCE[route] || {
    requiredTexts: [],
    minRowishElements: 1,
  };
  const bodyText = evidence.bodyText || "";
  for (const text of config.requiredTexts) {
    if (!bodyText.includes(text)) {
      reasons.push(`页面文本缺少 mock 数据标记: ${text}`);
    }
  }
  const rowish = (evidence.rowishCount ?? 0) || 0;
  if (rowish < config.minRowishElements) {
    reasons.push(`列表/卡片元素不足（${rowish} < ${config.minRowishElements}）`);
  }
  const pageErrors = evidence.pageErrors || [];
  for (const error of pageErrors.slice(0, 3)) {
    reasons.push(`pageerror: ${error}`);
  }
  const unmatched = evidence.unmatched || [];
  if (unmatched.length > 0) {
    reasons.push(`未命中 mock 的 /api/ 请求 ${unmatched.length} 个: ${unmatched.slice(0, 5).join(", ")}`);
  }
  return { ok: reasons.length === 0, reasons };
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

/** 安装 fail-closed API mock；未匹配请求回 500 并记入 state.unmatched。 */
export async function installApiMock(context, state = createMockState()) {
  // 只按「路径以 /api/ 开头」判断：不能用 "**/api/**" 这类 glob——它会把
  // 前端自己的源码模块（/src/api/*.ts）也拦下来，dev 模式下整个应用无法启动。
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => {
      const request = route.request();
      const decision = mockResponseFor(request.url(), request.method());
      if (!decision.matched) {
        state.unmatched.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
      return route.fulfill({
        status: decision.status,
        contentType: "application/json",
        body: JSON.stringify(decision.body),
      });
    },
  );
  return state;
}

/** 浏览器内采集渲染证据：mock 数据标记 / 行级元素数。 */
async function collectRenderEvidence(page, state) {
  const evidence = await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText : "";
    const rowishCount = document.querySelectorAll(
      ".ant-table-row, .ant-list-item, .ant-card, [class*=track]"
    ).length;
    return { bodyText, rowishCount };
  });
  evidence.pageErrors = state.pageErrors;
  evidence.unmatched = state.unmatched;
  return evidence;
}

/** 单次测量：指标只在业务断言全部通过后才记录。 */
async function measureOnce(browser, baseUrl, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const state = createMockState();
  state.pageErrors = [];
  await installApiMock(context, state);
  const page = await context.newPage();
  page.on("pageerror", (error) => state.pageErrors.push(String(error).split("\n")[0]));
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
  const result = { url, route };
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
    const evidence = await collectRenderEvidence(page, state);
    const verdict = assertRenderEvidence(route, evidence);
    result.assertions = verdict;
    if (!verdict.ok) {
      result.ok = false;
      result.error = verdict.reasons.join("; ");
      return result;
    }
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
      rows.push({ route, ok: false, reason: runs[0] ? runs[0].error : "no runs" });
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

// ---------------------------------------------------------------------------
// CLI（仅作为主模块执行时运行；导入本模块做契约测试不会触发任何副作用）。
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    prod: process.env.RF09_PROD_URL || "",
    dev: process.env.RF09_DEV_URL || "",
    routes: ["/", "/tracker"],
    runs: 3,
    out: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") opts.prod = argv[++i];
    else if (arg === "--dev") opts.dev = argv[++i];
    else if (arg === "--routes") opts.routes = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--runs") opts.runs = Number(argv[++i]);
    else if (arg === "--out") opts.out = argv[++i];
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
          "fail-closed: 未命中 mock 的 /api/ 请求、pageerror、业务断言失败都会让",
          "对应 run 判失败并打印原因；指标只来自断言通过的 run。",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  if (!opts.prod && !opts.dev) {
    console.error("需要至少提供 --prod 或 --dev 之一");
    process.exit(1);
  }
  if (!opts.out) {
    opts.out = path.join(REPO_ROOT_FOR_OUT, "rf09_fe_perf.json");
  }
  return opts;
}

const REPO_ROOT_FOR_OUT = path.resolve(__dirname, "..");
let options = null;

async function main() {
  const browser = await launchBrowser();
  const output = { generatedAt: new Date().toISOString(), runs: options.runs, routes: options.routes, targets: {} };
  let totalUnmatched = 0;
  try {
    if (options.prod) output.targets.prod = await measureTarget(browser, "prod(vite preview)", options.prod);
    if (options.dev) output.targets.dev = await measureTarget(browser, "dev(vite)", options.dev);
  } finally {
    await browser.close();
  }
  for (const target of Object.values(output.targets)) {
    for (const row of target) {
      if (row.ok === false) totalUnmatched += 1;
    }
  }
  const anyRouteOk = Object.values(output.targets).every((target) =>
    target.every((row) => row.ok),
  );
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(output, null, 2));
  console.log(`\n结果 JSON 已写入: ${options.out}`);
  // fail-closed：任何路由一个通过的 run 都没有 → 退出非零，不许装成功。
  if (!anyRouteOk) {
    console.error("存在没有任何成功 run 的路由（断言未过或导航失败）；退出码 1。");
    return 1;
  }
  return 0;
}

export async function runCli(argv) {
  options = parseArgs(argv);
  return main();
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
