/**
 * 截图 + 指标采集（方案 §7，T15）。
 *
 * 与 `frontend/tests/responsive/*.spec.ts` 的分工：
 *   - spec 是**门槛**（只判 R1/R2/R3，进 CI，失败即红）；
 *   - 本脚本是**证据**（10 视口 × 13 场景的 PNG + metrics.json + report.html，留人工看）。
 *
 * 跑法（需要 8123 上有打包同源服务）：
 *   node harness/capture.mjs --base http://127.0.0.1:8123 --out screenshots/after
 *   node harness/capture.mjs --base ... --out ... --viewports 1366,1092,768
 *
 * 只读：除 `localStorage["resumeforge.user-guide.seen"]` 外不写任何应用状态。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 仓库根与 playwright 的解析（2026-10-24 改）。
 *
 * 原先是 `createRequire("D:/ResumeForge/frontend/package.json")` —— 硬编码作者机器路径，
 * 别人 clone 下来第一行就崩。现在从脚本位置向上找 `pyproject.toml` + `frontend/package.json`，
 * 于是同一份脚本在 `deliverables/` 与 `docs/verification/` 下都能跑。
 */
function findRepoRoot(start) {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, "pyproject.toml")) && existsSync(join(dir, "frontend", "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO_ROOT = findRepoRoot(HERE);
if (!REPO_ROOT) {
  console.error("找不到仓库根：需要同时存在 pyproject.toml 与 frontend/package.json");
  process.exit(2);
}
const require = createRequire(join(REPO_ROOT, "frontend", "package.json"));

/** 截图与指标的默认落点：仓库内的 deliverables（该目录被 .gitignore 排除）。 */
const DEFAULT_OUT = join(
  REPO_ROOT,
  "deliverables",
  "software-company",
  "responsive-20261023",
  "screenshots",
  "after",
);

const { chromium } = require("playwright");
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const BASE = argOf("base", "http://127.0.0.1:8123");
const OUT = path.resolve(argOf("out", DEFAULT_OUT));
const ONLY = (argOf("viewports", "") || "").split(",").filter(Boolean);

/** 10 个真实档位（方案 §7.1）：8 个主档 + 2 个回归保护档。 */
const VIEWPORTS = [
  { slug: "V1-2560x1440", width: 2560, height: 1440 },
  { slug: "V2-2048x1280", width: 2048, height: 1280 },
  { slug: "V3-1920x1080", width: 1920, height: 1080 },
  { slug: "V4-1536x864", width: 1536, height: 864 },
  { slug: "V5-1440x900", width: 1440, height: 900 },
  { slug: "V6-1366x768", width: 1366, height: 768 },
  { slug: "V7-1280x720", width: 1280, height: 720 },
  { slug: "V8-1092x614", width: 1092, height: 614 },
  { slug: "V8b-960x600", width: 960, height: 600 },
  { slug: "V8c-768x1024", width: 768, height: 1024 },
];

const SCENES = [
  { slug: "P01-home", path: "/" },
  { slug: "P02-jobs", path: "/jobs" },
  {
    slug: "P03-job-detail",
    path: "/jobs",
    prepare: async (page) => {
      // 跳过 antd 的测量行（.ant-table-measure-row，aria-hidden）
      await page
        .locator("main table tbody tr:not(.ant-table-measure-row)")
        .first()
        .click({ timeout: 8000 });
      await page.waitForTimeout(600);
    },
  },
  { slug: "P04-resumes", path: "/resumes" },
  {
    slug: "P05-workbench",
    path: "/resumes",
    prepare: async (page) => {
      await page.getByRole("button", { name: "预览 / 导出" }).first().click({ timeout: 15000 });
      await page.waitForTimeout(900);
      await page.getByRole("button", { name: "简历制作台" }).first().click({ timeout: 15000 });
      await page.waitForSelector(".resume-wb-body", { timeout: 15000 });
      await page.waitForTimeout(1500);
    },
  },
  { slug: "P06-tracker", path: "/tracker" },
  { slug: "P07-assistant", path: "/assistant" },
  { slug: "P08-settings", path: "/settings" },
  { slug: "P09-profile", path: "/profile" },
  {
    slug: "P10-guide",
    path: "/",
    prepare: async (page) => {
      await page.getByRole("button", { name: "使用指南" }).first().click({ timeout: 8000 });
      await page.waitForSelector(".user-guide-body", { timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
  {
    slug: "P11-templates",
    path: "/resumes",
    prepare: async (page) => {
      // 模板一览在主预览的版式工具条里（简历中心列表页没有这组控件）。
      await page.getByRole("button", { name: "预览 / 导出" }).first().click({ timeout: 15000 });
      await page.waitForTimeout(900);
      await page
        .getByRole("button", { name: "选择简历模板并预览效果" })
        .first()
        .click({ timeout: 8000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    slug: "P12-new-resume",
    path: "/resumes",
    prepare: async (page) => {
      await page.getByRole("button", { name: /新建简历|生成简历/ }).first().click({ timeout: 8000 });
      await page.waitForTimeout(800);
    },
  },
  {
    slug: "P13-assistant-card",
    path: "/",
    prepare: async (page) => {
      await page.locator("button.tt").first().click({ timeout: 5000 });
      await page.waitForTimeout(800);
    },
  },
];

/** 与 spec 同一套口径（R1/R2/R3），这里多采两项供 rubric 用（prose / a4）。 */
async function collect(page) {
  return page.evaluate(() => {
    const scrollable = (node) => {
      const style = getComputedStyle(node);
      return style.overflowX === "auto" || style.overflowX === "scroll";
    };
    const hasScrollableAncestor = (node) => {
      let current = node.parentElement;
      while (current) {
        if (scrollable(current)) return true;
        current = current.parentElement;
      }
      return false;
    };
    const clipped = [];
    for (const node of document.querySelectorAll("main *")) {
      if (node.scrollWidth <= node.clientWidth + 1) continue;
      const style = getComputedStyle(node);
      if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
      // 看不见的节点不算"内容被裁"：antd 的 Select 占位符是 opacity:0 的测量节点，
      // 数据加载中的一帧会比容器宽（2026-10-23 实测到的唯一一类误报）。
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      // 刻意的单行省略（`ellipsis + nowrap`）不是"内容被裁"：列表标题、卡片标题都是这种形态。
      if (style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap") continue;
      if (node.closest('[aria-hidden="true"]')) continue;
      if (hasScrollableAncestor(node)) continue;
      if (!node.textContent?.trim()) continue;
      // 表单控件不算：`<input>` 的 scrollWidth 永远 ≥ clientWidth（文本在框内滚动）。
      if (node.matches("input, textarea, select")) continue;
      const classes = typeof node.className === "string" ? node.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      clipped.push(`${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`);
    }
    const outOfViewport = [];
    for (const node of document.querySelectorAll("main *")) {
      if (node.closest(".ant-drawer, .ant-modal-root, .ant-tooltip, .ant-dropdown")) continue;
      if (getComputedStyle(node).position === "fixed") continue;
      if (hasScrollableAncestor(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) outOfViewport.push(node.tagName.toLowerCase());
    }
    const prose = [...document.querySelectorAll(".assistant-message, .rf-prose")]
      .map((node) => ({
        width: Math.round(node.getBoundingClientRect().width),
        fontSize: Number.parseFloat(getComputedStyle(node).fontSize) || 14,
      }))
      .filter((item) => item.width > 0);
    // R5：工具条行数（同一容器内直接子控件的纵向分带数）。用具体选择器而不是
    // `[data-rf-toolbar]`：本仓还没有那个属性，而为一条指标去改 20 个组件不值得。
    // 只统计**动作组**（一排按钮）：筛选条与页头是"内容 + 动作"的混合行，按设计允许换行，
    // 把它们算进来会让 R5 永远红（方案 §7.5 的原话是"同组按钮不换行"）。
    const TOOLBAR_SELECTORS = [
      ".resume-wb-actionbar",
      ".assistant-header-actions",
      ".resume-preview-zoom-row",
    ];
    const toolbars = TOOLBAR_SELECTORS.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const children = [...node.children].filter((child) => child.getBoundingClientRect().height > 0);
      if (children.length < 2) return null;
      // 聚簇而不是"除以 4 取整"：后者的桶边界会把 11.3 与 12.1 判成两行（实测误报）。
      // 相邻 top 相差 > 8px 才算另起一行——同一行的控件高度不同（按钮 24 / 文字 22），
      // 居中后 top 会差 1–2px。
      const tops = children.map((child) => child.getBoundingClientRect().top).sort((a, b) => a - b);
      let lines = 1;
      for (let i = 1; i < tops.length; i += 1) {
        if (tops[i] - tops[i - 1] > 8) lines += 1;
      }
      return { selector, lines };
    }).filter(Boolean);

    // R6：同一网格内相邻卡片的实际间距极差。
    const GRID_SELECTORS = [
      ".tracker-summary",
      ".home-shortcuts",
      ".resume-card-grid",
      ".template-gallery-grid",
      ".materials-grid",
      ".knowledge-grid",
    ];
    const gridGaps = GRID_SELECTORS.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const items = [...node.children].filter((child) => child.getBoundingClientRect().width > 0);
      if (items.length < 3) return null;
      const lefts = items.map((item) => item.getBoundingClientRect().left).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < lefts.length; i += 1) {
        const gap = lefts[i] - lefts[i - 1];
        if (gap > 8) gaps.push(gap); // 跨行时 left 会回到行首，差值≈整行宽，跳过
      }
      if (gaps.length < 2) return null;
      return { selector, delta: Math.round(Math.max(...gaps) - Math.min(...gaps)) };
    }).filter(Boolean);

    const paper = document.querySelector(".resume-preview-page");
    const main = document.querySelector("main");
    // R8：大屏右侧空白 = 内容区最右元素到 main 右缘的距离。
    let emptyRight = null;
    if (main && window.innerWidth >= 1920) {
      const mainRect = main.getBoundingClientRect();
      let maxRight = mainRect.left;
      for (const node of main.querySelectorAll("*")) {
        if (node.closest(".ant-drawer, .ant-modal-root, .ant-tooltip")) continue;
        if (getComputedStyle(node).position === "fixed") continue;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right > maxRight && rect.right <= mainRect.right + 1) maxRight = rect.right;
      }
      emptyRight = Math.round(mainRect.right - maxRight);
    }
    return {
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      clipped: [...new Set(clipped)],
      outOfViewport: [...new Set(outOfViewport)].slice(0, 10),
      prose,
      toolbars,
      gridGaps,
      emptyRight,
      a4: paper
        ? {
            paperWidth: Math.round(paper.getBoundingClientRect().width),
            scale: Number((paper.getBoundingClientRect().width / 794).toFixed(3)),
            clamped: Boolean(document.querySelector(".resume-preview-zoom-label.is-min-scale")),
          }
        : null,
    };
  });
}

const browser = await chromium.launch();
const results = [];
const viewports = VIEWPORTS.filter((viewport) => ONLY.length === 0 || ONLY.includes(String(viewport.width)));

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
  const page = await context.newPage();

  for (const scene of SCENES) {
    const dir = path.join(OUT, viewport.slug);
    await mkdir(dir, { recursive: true });
    const started = Date.now();
    const record = { viewport: viewport.slug, scene: scene.slug, width: viewport.width, height: viewport.height };
    try {
      // 等网络静下来再量：`domcontentloaded` 时列表还是骨架屏，量到的"窄容器"是加载态，
      // 不是布局缺陷（2026-10-23 的 profile 假阳性就是这么来的）。
      await page.goto(BASE + scene.path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForSelector("main >> *", { timeout: 20000 });
      await page.waitForTimeout(1200);
      const close = page.locator(".ant-modal-close");
      if (await close.count()) await close.first().click({ timeout: 2000 }).catch(() => {});
      if (scene.prepare) await scene.prepare(page);
      await page.screenshot({ path: path.join(dir, `${scene.slug}.png`) });
      Object.assign(record, await collect(page));
    } catch (error) {
      record.error = String(error?.message ?? error).slice(0, 200);
    }
    record.ms = Date.now() - started;
    results.push(record);
    console.log(`${viewport.slug} ${scene.slug} ${record.error ? `ERROR ${record.error}` : "ok"} ${record.ms}ms`);
  }
  await context.close();
}

await browser.close();
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "metrics.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(`\n${results.length} 组指标 → ${path.join(OUT, "metrics.json")}`);
