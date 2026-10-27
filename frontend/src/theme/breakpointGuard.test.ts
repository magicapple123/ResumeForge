// SPDX-License-Identifier: Apache-2.0
/**
 * 断点三方同源守卫。
 *
 * 媒体查询**不能**引用 CSS 变量（`@media (max-width: var(--x))` 无效），所以"同一个数只有
 * 一处真相"这件事没法靠 CSS 自己做到，只能靠一条测试钉住。本仓已有同样的惯例：
 * `colorGuard` / `cjkRatchet` / `antdOverrideGuard` / `spinOutletGuard`。
 *
 * 四条断言：
 *  1. `:root` 里的 `--rf-bp-*` 与 `theme/breakpoints.ts` 的 BREAKPOINTS 逐项相等、键集合相同；
 *  2. 每条 `@media (max|min)-width: Npx` 的 N 必须属于断点集（或已登记的 LEGACY 白名单）；
 *  3. LEGACY 棘轮：非标准数值的出现次数只许下降（新增一处就红，并把文件与数值点名）；
 *  4. 禁止 range 语法 `(width <= Npx)` —— 全仓统一成 `(max-width: Npx)`，否则第 2 条扫不到。
 *
 * 为什么是"棘轮"而不是一次性清零：存量里有些数值（480 的 AI 润色浮层、640 的资料表单）
 * 是就地微调，值得保留但需要登记。棘轮保证**不会更烂**，同时不阻塞本轮交付；
 * 每次收紧会在失败信息里打印"可以收紧基线了"。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS, BREAKPOINT_VALUES } from "./breakpoints";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 扫描范围与 `antdOverrideGuard` 一致：`styles/` 与 `theme/` 的**顶层** CSS（非递归）。 */
const SCANNED_DIRECTORIES = ["styles", "theme"];

/** 断点镜像变量的文件名与键前缀。 */
const TOKENS_FILE = join(SRC_ROOT, "theme", "design-tokens.css");
const TOKEN_PREFIX = "--rf-bp-";

/**
 * 存量非标准断点的基线（`文件:数值` → 允许出现的次数）。
 *
 * 只降不升。删除某一条的时机 = 该处数值已被归一或规则被删掉；新增标准断点**不要**
 * 登记到这里，标准值本身是允许的。
 */
const LEGACY: Record<string, number> = {
  "styles/aiPolish.css:480": 1,
  "styles/announcement.css:600": 1,
  "styles/apply.css:768": 1,
  "styles/base-panels.css:720": 1,
  "styles/modules-layout.css:1000": 1,
  "styles/modules-templates.css:575": 1,
  "styles/modules-webform.css:760": 1,
  "styles/profile.css:640": 1,
  "styles/responsive.css:575": 1,
  "styles/resume-editor.css:640": 1,
  "styles/resume-panels.css:720": 1,
  "styles/workbench-narrow.css:1000": 1,
  "styles/workbench-narrow.css:1280": 1,
  "styles/tracker-form.css:900": 1,
  "styles/trash.css:768": 1,
};

interface MediaHit {
  file: string;
  value: number;
  line: number;
}

function collectCssFiles(): string[] {
  const files: string[] = [];
  for (const directory of SCANNED_DIRECTORIES) {
    for (const entry of readdirSync(join(SRC_ROOT, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
      files.push(join(SRC_ROOT, directory, entry.name));
    }
  }
  return files;
}

/** 注释换成等量换行：行号保持不变，注释里的示例写法不参与判定。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    String.fromCharCode(10).repeat((comment.match(/\n/g) ?? []).length),
  );
}

/** 抽出一条 CSS 里所有按宽度分档的媒体查询。 */
function collectMediaHits(file: string, source: string): MediaHit[] {
  const stripped = stripComments(source);
  const hits: MediaHit[] = [];
  const lines = stripped.split(String.fromCharCode(10));
  lines.forEach((text, index) => {
    if (!text.includes("@media")) return;
    for (const match of text.matchAll(/\(\s*(?:max|min)-width\s*:\s*(\d+)px\s*\)/g)) {
      hits.push({ file, value: Number(match[1]), line: index + 1 });
    }
    // 旧 range 语法也收进来，这样第 2 条的"不在断点集"能看见它，第 4 条再单独判语法。
    for (const match of text.matchAll(/\(\s*width\s*[<>]=?\s*(\d+)px\s*\)/g)) {
      hits.push({ file, value: Number(match[1]), line: index + 1 });
    }
  });
  return hits;
}

function relativeToSrc(absolute: string): string {
  return relative(SRC_ROOT, absolute).split(sep).join("/");
}

describe("断点单一事实源", () => {
  it("CSS 变量与 TS 常量逐值相等、键集合相同", () => {
    const css = readFileSync(TOKENS_FILE, "utf8");
    const declared: Record<string, number> = {};
    for (const match of css.matchAll(new RegExp(`${TOKEN_PREFIX}([a-z]+):\\s*(\\d+)px`, "g"))) {
      declared[match[1]] = Number(match[2]);
    }
    const expected: Record<string, number> = { ...BREAKPOINTS };
    expect(declared, "design-tokens.css 的 --rf-bp-* 必须与 theme/breakpoints.ts 一一对应").toEqual(
      expected,
    );
  });

  it("所有媒体查询的数值都属于断点集（或已登记的 LEGACY）", () => {
    const offenders: string[] = [];
    for (const absolute of collectCssFiles()) {
      const file = relativeToSrc(absolute);
      for (const hit of collectMediaHits(file, readFileSync(absolute, "utf8"))) {
        if (BREAKPOINT_VALUES.includes(hit.value)) continue;
        if ((LEGACY[`${hit.file}:${hit.value}`] ?? 0) > 0) continue;
        offenders.push(`${hit.file}:${hit.line}  ${hit.value}px`);
      }
    }
    expect(
      offenders,
      "新写的 @media 数值必须来自 theme/breakpoints.ts（767/1092/1366/1536/1920/2048）。" +
        "存量非标准值登记在 LEGACY，新增它们需要先说明理由：\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("LEGACY 棘轮：非标准数值的出现次数只许下降", () => {
    const counts = new Map<string, number>();
    for (const absolute of collectCssFiles()) {
      const file = relativeToSrc(absolute);
      for (const hit of collectMediaHits(file, readFileSync(absolute, "utf8"))) {
        if (BREAKPOINT_VALUES.includes(hit.value)) continue;
        const key = `${hit.file}:${hit.value}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    const grown: string[] = [];
    const tightened: string[] = [];
    for (const [key, allowed] of Object.entries(LEGACY)) {
      const actual = counts.get(key) ?? 0;
      if (actual > allowed) grown.push(`${key}：${allowed} → ${actual}`);
      if (actual < allowed) tightened.push(`${key}：${allowed} → ${actual}（可以收紧基线了）`);
    }
    // 未登记的非标准值已经在第 2 条判过；这里只判"同一个键变多"，所以只看 known key。
    expect(
      grown,
      "非标准断点的出现次数上涨了。要么改用 6 个标准值，要么先登记 LEGACY：" + grown.join("；"),
    ).toEqual([]);
    if (tightened.length > 0) {
      // 只提示，不失败：下降本来就允许。
      console.log(`[breakpointGuard] ${tightened.join("；")}`);
    }
  });

  it("容器查询只在登记的两个文件里出现", () => {
    // 为什么钉住文件数：`container-type: inline-size` 会让该元素成为 position:fixed 后代的
    // 包含块（方案 §3.5）。工作台弹窗体与中栏内部没有 fixed 后代，所以安全；一旦有人在
    // `.app-content` 上开容器查询，网申页右下角的浮球会改为相对内容区定位、滚出屏幕。
    const allowed = new Set(["styles/workbench-narrow.css", "styles/resume-workbench-tabs.css"]);
    const offenders: string[] = [];
    for (const absolute of collectCssFiles()) {
      const file = relativeToSrc(absolute);
      const source = stripComments(readFileSync(absolute, "utf8"));
      if (!source.includes("container-type")) continue;
      if (!allowed.has(file)) offenders.push(file);
    }
    expect(offenders, "容器查询新增了文件，先读方案 §3.5 的包含块风险再登记").toEqual([]);
  });

  it("禁止 range 语法（width <= Npx）", () => {
    const offenders: string[] = [];
    for (const absolute of collectCssFiles()) {
      const file = relativeToSrc(absolute);
      const lines = stripComments(readFileSync(absolute, "utf8")).split(String.fromCharCode(10));
      lines.forEach((text, index) => {
        if (/\(\s*width\s*[<>]=?\s*\d+px\s*\)/.test(text)) {
          offenders.push(`${file}:${index + 1}  ${text.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "媒体查询统一写成 `@media (max-width: Npx)`；range 语法会让断点扫描失效：" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
