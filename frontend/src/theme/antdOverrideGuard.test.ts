// SPDX-License-Identifier: Apache-2.0
/**
 * `.ant-*` 覆写守卫（G2）：直属 antd 内部类名的 CSS 规则必须就地说明理由。
 *
 * 为什么需要这条守卫：`.ant-*` 是 antd 的**内部**类名，升级即可能消失（本轮审计里
 * `.ant-modal-content` → `.ant-modal-container` 就是活例）。因此每一处覆写都必须是
 * "已经想清楚"的决定，而不是顺手加的一条。审计 §7.4 把保留理由归纳成四类：
 * 布局无 token / 无障碍补偿 / 私有形态 / antd 类名版本迁移 —— 守卫不判断理由写得好不好，
 * 只强制"理由当场可见"。
 *
 * 判定顺序（对每条含 `.ant-` 的规则块）：
 *  1. 文件级白名单：`accessibility.css` / `dark-tokens.css` / `mobile.css` —— 这三个是
 *     本轮逐条审过的（无障碍补偿、深色 token 映射、移动端布局），整体放行；
 *  2. 选择器**已被自定义类名限定**（`.app-` / `.rf-` / `.settings-` / `.trash-` …）——
 *     说明这条覆写只作用于自己的容器，属既有约定的"作用域内局部修正"。
 *     判据写成"出现任意一个非 `ant-` 开头的 class"，**不是**硬编码前缀数组：
 *     本仓自定义前缀二十多个，数组列不全就会误报，而误报会逼着人顺手加注释绕过；
 *     3. 规则本身或上方 3 行 / 块内前 200 字符有 `/* antd-override: <理由> *\/` —— 规则级豁免。
 *
 * 白名单刻意是硬编码数组而不是配置文件：这三个文件不该再长出第四个，真要新增就得改守卫
 * 并在这里写下理由。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 换行符常量：避免在模板里直接写它，编辑器/工具链来回转义时最容易被吃掉。 */
const CH_NEWLINE = String.fromCharCode(10);

/** `src/` 根目录：本文件在 `src/theme/` 下，向上一层即是。 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 只扫这两处：业务样式表与主题 token 表。 */
const SCANNED_DIRECTORIES = ["styles", "theme"];

/** 文件级白名单（相对 `src/`）：本轮已逐条审过，整体放行。 */
const ALLOWED_FILES = new Set([
  "styles/accessibility.css",
  "styles/mobile.css",
  "theme/dark-tokens.css",
]);

/**
 * 自定义类名判定：选择器里出现**任何一个不是 antd 内部类名**的 class，就认为这条覆写
 * 已被作用域限定（`.trash-page .ant-table-cell`、`.app-nav-menu .ant-menu-item` 都是）。
 *
 * 为什么不用固定前缀白名单：本仓的自定义前缀有二十多个（`.app-` / `.rf-` / `.webform-` /
 * `.settings-` / `.resume-` / `.tracker-` / `.trash-` …），列不全就会误报，而误报会让
 * 规则被"顺手加注释"绕过。语义上的判据只有一条：**这条规则是否只作用于自己的容器**。
 */
function isScoped(selector: string): boolean {
  const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  return classes.some((name) => !name.startsWith("ant-"));
}

/** 规则级豁免标记：冒号后写四类理由之一 + 一句实情。 */
const EXEMPTION_MARKER = "antd-override:";

/** 空话式豁免（写了等于没写）。 */
const VAGUE_REASONS = new Set(["ok", "todo", "tbd", "待定", "暂缓", "later", "wip", "fixme"]);

interface Violation {
  /** 相对 `src/` 的路径。 */
  file: string;
  /** 1 起的行号（选择器所在行）。 */
  line: number;
  /** 命中的选择器（多行选择器压成一行）。 */
  selector: string;
}

/** 收集待扫描的样式表（绝对路径）。 */
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

/**
 * 把注释换成等量换行：注释文本不再干扰选择器分析，而行号保持不变。
 *
 * 为什么先剥注释：`/* 说明 .ant-modal-content 已改名 *\/` 这种句子会让"选择器里有
 * `.ant-`"的判定误报，也会让前缀判定读到注释里的字样。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    CH_NEWLINE.repeat((comment.match(/\n/g) ?? []).length),
  );
}

/** 偏移量 → 1 起的行号。 */
function lineOfOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(CH_NEWLINE).length;
}

/**
 * 抽出所有规则块的选择器与行号。
 *
 * 用花括号扫描而不是逐行正则：一个规则的选择器可能跨多行（本仓的 `.ant-table-tbody`
 * 就是两条选择器换行并列），逐行正则会把它拆成两半。
 */
function selectorsOf(source: string): { selector: string; line: number; blockStart: number }[] {
  const stripped = stripComments(source);
  const results: { selector: string; line: number; blockStart: number }[] = [];
  let boundary = 0;

  for (let index = 0; index < stripped.length; index += 1) {
    const char = stripped[index];
    if (char === "}") {
      boundary = index + 1;
      continue;
    }
    if (char !== "{") continue;
    const raw = stripped.slice(boundary, index);
    const text = raw.trim();
    const leading = raw.length - raw.trimStart().length;
    if (text.length > 0) {
      results.push({
        selector: text.replace(/\s+/g, " "),
        line: lineOfOffset(stripped, boundary + leading),
        blockStart: index,
      });
    }
    boundary = index + 1;
  }
  return results;
}

/** 规则是否带规则级豁免（本行 / 上方 3 行 / 块内前 200 字符）。 */
function hasExemption(source: string, line: number, lines: string[], blockStart: number): boolean {
  // 三行之上到本行：注释通常写在规则前面；块内前 200 字符：也允许写在声明区首行。
  const before = lines.slice(Math.max(0, line - 4), line).join(CH_NEWLINE);
  const window = before + CH_NEWLINE + source.slice(blockStart, blockStart + 200);
  const at = window.indexOf(EXEMPTION_MARKER);
  if (at === -1) return false;
  const rest = window.slice(at + EXEMPTION_MARKER.length).split(CH_NEWLINE)[0];
  const reason = rest.replace(/\*\/$/, "").trim().toLowerCase();
  return !VAGUE_REASONS.has(reason);
}

/** 找出一份样式表里未说明理由的 `.ant-*` 覆写。 */
function collectViolations(file: string, source: string): Violation[] {
  if (ALLOWED_FILES.has(file)) return [];
  const lines = source.split(CH_NEWLINE);
  const violations: Violation[] = [];

  for (const rule of selectorsOf(source)) {
    // 只关心"选择器里出现 antd 内部类名"的规则块（`@media` 之类的前缀不是选择器）。
    if (!/(^|[\s,>+~(])\.ant-/.test(rule.selector)) continue;
    if (isScoped(rule.selector)) continue;
    if (hasExemption(source, rule.line, lines, rule.blockStart)) continue;
    violations.push({ file, line: rule.line, selector: rule.selector });
  }
  return violations;
}

describe("`.ant-*` 覆写守卫", () => {
  it("直属 antd 内部类名的规则都要写理由（或无自定义前缀的作用域）", () => {
    const violations: Violation[] = [];

    for (const absolute of collectCssFiles()) {
      const file = relative(SRC_ROOT, absolute).split(sep).join("/");
      violations.push(...collectViolations(file, readFileSync(absolute, "utf8")));
    }

    expect(
      violations,
      "这些规则直接改 antd 内部类名却没有说明理由。请二选一：① 用自定义类名做作用域" +
        "（`.app-xxx .ant-...`）；② 在规则本行/上方 3 行/块首加 " +
        "`/* antd-override: <布局无 token | 无障碍补偿 | 私有形态 | 类名版本迁移> + 一句实情 */`：" +
        CH_NEWLINE +
        violations.map((item) => `${item.file}:${item.line}  ${item.selector}`).join(CH_NEWLINE),
    ).toEqual([]);
  });

  it("守卫自身：裸覆写要报、有理由放行、白名单文件放行、带前缀放行", () => {
    const bare = [".ant-spin {", "  color: red;", "}"].join(CH_NEWLINE);
    expect(collectViolations("styles/sample.css", bare)).toEqual([
      { file: "styles/sample.css", line: 1, selector: ".ant-spin" },
    ]);

    const annotated = [
      "/* antd-override: 布局无 token —— Spin 容器没有对应的组件 token */",
      ".ant-spin {",
      "  color: red;",
      "}",
    ].join(CH_NEWLINE);
    expect(collectViolations("styles/sample.css", annotated)).toEqual([]);

    const insideBlock = [
      ".ant-spin {",
      "  /* antd-override: 私有形态 —— 只有一个页面用到这个尺寸 */",
      "  color: red;",
      "}",
    ].join(CH_NEWLINE);
    expect(collectViolations("styles/sample.css", insideBlock)).toEqual([]);

    const vague = ["/* antd-override: ok */", ".ant-spin {", "  color: red;", "}"].join(CH_NEWLINE);
    expect(collectViolations("styles/sample.css", vague)).toHaveLength(1);

    // 文件级白名单。
    expect(collectViolations("styles/accessibility.css", bare)).toEqual([]);

    // 自定义前缀作用域。
    const scoped = [".app-nav-menu .ant-menu-item {", "  color: red;", "}"].join(CH_NEWLINE);
    expect(collectViolations("styles/sample.css", scoped)).toEqual([]);

    // 多行选择器并列也要能识别（本仓 `.ant-table-tbody > tr...` 就是这种形态）。
    const multiLine = [".ant-table-thead,", ".ant-table-tbody {", "  color: red;", "}"].join(
      CH_NEWLINE,
    );
    expect(collectViolations("styles/sample.css", multiLine)).toHaveLength(1);

    // 注释里提到 `.ant-` 不算覆写。
    const commentOnly = [
      "/* 旧类名 .ant-modal-content 已改为 .ant-modal-container */",
      ".app-card {",
      "  color: red;",
      "}",
    ].join(CH_NEWLINE);
    expect(collectViolations("styles/sample.css", commentOnly)).toEqual([]);
  });
});
