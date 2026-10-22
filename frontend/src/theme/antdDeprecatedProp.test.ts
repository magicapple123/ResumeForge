// SPDX-License-Identifier: Apache-2.0
/**
 * 废弃属性守卫：antd 的「文案载体属性」必须用当前主版本的推荐写法。
 *
 * 判定依据**只有两处**（别在代码里散落规则，改判定请先改文档与 `.d.ts`）：
 * - `docs/ui-copy-guide.md` §4.14（`文案载体属性：不用废弃属性`）的判定表；
 * - 当前安装版本的 `.d.ts`：`node_modules/antd/es/alert/Alert.d.ts:48-55`
 *   与 `node_modules/antd/es/notification/interface.d.ts:38-46`。
 *
 * | 组件 | 用这个 | 不要用（`@deprecated`） |
 * |---|---|---|
 * | `Alert` | `title` / `description` | `message` |
 * | `notification.*` | `title` / `description` / `actions` | `message` / `btn` |
 *
 * 为什么值得一条守卫：`@deprecated` 只是 JSDoc，`tsc` 与 eslint 都全绿，问题以
 * "看起来正常的代码"长期存在——本项目就攒下过 4 处 `Alert message=` + 1 处
 * `notification message:`（B5 已清完），靠人眼复查漏了一轮。
 *
 * ## 两个必须排除的"同名但不是 antd"（它们不是豁免，是判定范围）
 *
 * 1. `fireWebNotification(payload.message, …)`（`components/TaskCompletionNotifier.tsx`）：
 *    浏览器原生 `Notification`，参数名恰好也叫 message。判定只认 `notification.` /
 *    `notification[...]` 这种**成员访问**，`fireWebNotification(` 是别的函数名，因此天然
 *    不在范围内——本文件的 `(?<![\w.$])` 前视就是在钉这件事。
 * 2. `<StreamingStatus message={…}>`（`features/assistant/components/AssistantMessageList.tsx`）：
 *    本项目自定义组件的 prop，与 antd 无关。判定只扫 **`<Alert` 元素块**，别的组件不进来。
 *
 * 扫描范围：`src/**\/*.tsx`，排除 `*.test.tsx`（测试要写"故意的坏样板"来验证守卫本身）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../i18n/cjkScan";

/** `src/` 根目录：本文件在 `src/theme/` 下，向上一层即是。 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 不扫的目录：测试目录与构建产物。 */
const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage"]);

/** 不扫的文件：`.test.tsx` 自己会写违规样板。 */
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

/** `<Alert` 元素起点（后面允许紧跟换行与属性）。 */
const ALERT_TAG = /<Alert(?![A-Za-z0-9_])/g;

/**
 * `notification.open|success|…(` 或 `notification[key](`：两种调用形态都要能进对象体。
 *
 * `TaskCompletionNotifier` 用的是 `notification[payload.type]({ … })`——按 `notification.open(`
 * 逐字匹配会漏掉它，那正是最需要盯的一处（它的对象体里就摆着 title / description）。
 */
const NOTIFICATION_CALL =
  /(?<![\w.$])notification\s*(?:\.\s*(?:open|success|error|info|warning|warn)|\[[^\]]*\])\s*\(/g;

/** 属性名出现在这些位置不算 antd 的属性（`payload.message` 是读别人的字段）。 */
const NOT_OUR_PROP = "(?<![\\w.$])";

/** `Alert` 上的废弃属性：只查 `message`（`description` 是正选，放行）。 */
const ALERT_DEPRECATED = new RegExp(`${NOT_OUR_PROP}message\\s*=`, "g");

/** `notification` 对象体上的废弃属性：`message` 与 `btn`。 */
const NOTIFICATION_DEPRECATED = new RegExp(`${NOT_OUR_PROP}(?:message|btn)\\s*:`, "g");

interface Violation {
  /** 相对 `src/` 的路径。 */
  file: string;
  /** 1 起的行号。 */
  line: number;
  /** 命中的原文（已 trim）。 */
  text: string;
  /** 该换成什么，便于照着改。 */
  suggestion: string;
}

/** 递归收集待扫描的源码文件（绝对路径）。 */
function collectSourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      collectSourceFiles(absolute, collected);
      continue;
    }
    if (!/\.tsx$/.test(entry.name)) continue;
    if (TEST_FILE_PATTERN.test(entry.name)) continue;
    collected.push(absolute);
  }
  return collected;
}

/** 偏移量 → 1 起的行号。 */
function lineOfOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(String.fromCharCode(10)).length;
}

/**
 * 从 `openIndex`（指向开括号）起找到配平的闭括号位置。
 *
 * 需要它是因为属性/对象体大量换行书写（本项目 `grep "<Alert" | grep "title="` 只得 41，
 * 按元素块扫得 131）——逐行正则会把换行写的 `message=` 整片漏掉。
 * 字符串里的括号不算配平（`title="…（含括号）"` 很常见）。
 */
function matchBalanced(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** `<Alert` 开标签的结束位置（`>` 且不在括号/字符串里）；找不到返回 -1。 */
function findTagEnd(source: string, tagStart: number): number {
  let braceDepth = 0;
  let quote = "";
  for (let index = tagStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === ">" && braceDepth === 0) return index;
  }
  return -1;
}

/**
 * 找出一个源码文本里的全部违规点。
 *
 * 抽成纯函数是为了用合成样板验证「守卫本身有效」：一条永远匹配不到东西的正则会让守卫
 * 看起来是绿的，那比没有守卫更危险（与 `antdStaticGuard` 的自测同一目的）。
 */
function collectViolations(file: string, rawSource: string): Violation[] {
  // 先剥注释：注释里举例写的 `message=` 不是真代码，不该报。
  // 但 `stripComments` 会改变长度，所以行号一律按"剥注释后"的位置算——它保留换行，
  // 与原文件的行号一致。
  const source = stripComments(rawSource);
  const lines = source.split(String.fromCharCode(10));
  const violations: Violation[] = [];

  for (const match of source.matchAll(ALERT_TAG)) {
    const start = match.index ?? 0;
    const end = findTagEnd(source, start);
    if (end < 0) continue;
    const block = source.slice(start, end + 1);
    for (const hit of block.matchAll(ALERT_DEPRECATED)) {
      const offset = start + (hit.index ?? 0);
      violations.push({
        file,
        line: lineOfOffset(source, offset),
        text: (lines[lineOfOffset(source, offset) - 1] ?? block).trim(),
        suggestion: "Alert 的正文用 title= 写（description= 是副文案，保留）",
      });
    }
  }

  for (const match of source.matchAll(NOTIFICATION_CALL)) {
    const callStart = (match.index ?? 0) + match[0].length - 1;
    const objectStart = source.indexOf("{", callStart);
    if (objectStart < 0) continue;
    // 参数不是对象字面量（例如 `notification.open(props)`）就跳过：那种情况属性不在这里。
    if (source.slice(callStart + 1, objectStart).trim().length > 0) continue;
    const objectEnd = matchBalanced(source, objectStart, "{", "}");
    if (objectEnd < 0) continue;
    const body = source.slice(objectStart, objectEnd + 1);
    for (const hit of body.matchAll(NOTIFICATION_DEPRECATED)) {
      const offset = objectStart + (hit.index ?? 0);
      violations.push({
        file,
        line: lineOfOffset(source, offset),
        text: (lines[lineOfOffset(source, offset) - 1] ?? body).trim(),
        suggestion: "notification 的标题用 title:，按钮用 actions:",
      });
    }
  }

  return violations;
}

describe("antd 废弃属性守卫", () => {
  it("业务代码里没有 Alert message= / notification message: / btn:", () => {
    const violations: Violation[] = [];
    for (const absolute of collectSourceFiles(SRC_ROOT)) {
      const file = relative(SRC_ROOT, absolute).split(sep).join("/");
      violations.push(...collectViolations(file, readFileSync(absolute, "utf8")));
    }
    expect(
      violations,
      "这些地方用了 antd 已标 @deprecated 的文案属性（判定见 docs/ui-copy-guide.md §4.14 " +
        "与 node_modules/antd 的 .d.ts）：" +
        String.fromCharCode(10) +
        violations
          .map((item) => `${item.file}:${item.line}  ${item.text}  →  ${item.suggestion}`)
          .join(String.fromCharCode(10)),
    ).toEqual([]);
  });

  it("扫描器确实是活的：全库 100+ 个 Alert、6 处 notification 调用都被读进来了", () => {
    const files = collectSourceFiles(SRC_ROOT).map((absolute) => readFileSync(absolute, "utf8"));
    const alertCount = files.reduce(
      (total, source) => total + [...stripComments(source).matchAll(ALERT_TAG)].length,
      0,
    );
    const notificationCount = files.reduce(
      (total, source) => total + [...stripComments(source).matchAll(NOTIFICATION_CALL)].length,
      0,
    );
    // 阈值只用来发现"抽取整体失效"（例如 `<Alert` 改成别的写法后正则静默失效），
    // 不是给人卡的配额。
    expect(alertCount).toBeGreaterThan(100);
    expect(notificationCount).toBeGreaterThan(0);
  });

  it("守卫自身能识别四类写法，并放行正确属性与同名非 antd 调用", () => {
    // 1. Alert 用 message= → 报；换成 title= / description= → 不报。
    const badAlert = [
      "export function A() {",
      '  return <Alert type="info" message="提示" description="细节" />;',
      "}",
    ].join(String.fromCharCode(10));
    expect(collectViolations("sample/alert.tsx", badAlert)).toHaveLength(1);

    const goodAlert = [
      "export function B() {",
      "  return (",
      '    <Alert type="info" title="提示" description="细节">',
      "      正文",
      "    </Alert>",
      "  );",
      "}",
    ].join(String.fromCharCode(10));
    expect(collectViolations("sample/alert-ok.tsx", goodAlert)).toEqual([]);

    // 2. 属性换行书写也要抓到（逐行正则最容易漏的形态）。
    const multilineAlert = [
      "export function C() {",
      "  return <Alert",
      '    type="warning"',
      '    message="换行写的标题"',
      "  />;",
      "}",
    ].join(String.fromCharCode(10));
    expect(collectViolations("sample/alert-multiline.tsx", multilineAlert)).toHaveLength(1);

    // 3. notification 对象体里用 message: / btn: → 报；title: 与 actions: → 不报。
    const badNotification = [
      "const { notification } = App.useApp();",
      'notification.success({ message: "完成", btn: "查看" });',
    ].join(String.fromCharCode(10));
    expect(collectViolations("sample/notification.tsx", badNotification)).toHaveLength(2);

    const dynamicNotification = [
      "const { notification } = App.useApp();",
      'notification[payload.type]({ key: "k", title: "完成", actions: "查看" });',
    ].join(String.fromCharCode(10));
    expect(collectViolations("sample/notification-dynamic.tsx", dynamicNotification)).toEqual([]);

    // 4. 浏览器原生通知与自定义组件的同名 prop 都不该报。
    const notAntd = [
      "fireWebNotification(payload.message, payload.description);",
      'const payload = { type: "error", message: "失败" };',
      "const el = <StreamingStatus message={streamingText} />;",
    ].join(String.fromCharCode(10));
    expect(collectViolations("sample/not-antd.tsx", notAntd)).toEqual([]);
  });
});
