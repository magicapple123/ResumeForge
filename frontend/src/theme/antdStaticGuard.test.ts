// SPDX-License-Identifier: Apache-2.0
/**
 * 静态调用守卫（G1）：antd 的 `Modal.*` / `notification.*` / `message` 静态方法必须走
 * `App.useApp()`，不许直接从 `antd` 根具名导入。
 *
 * 为什么需要这条守卫：antd 的静态方法不读 React tree 里的 `ConfigProvider`。以
 * `node_modules/antd/es/modal/confirm.js` 为例，静态 `confirm()` 的 `theme` 只取
 * `globalConfig().config.theme`；而本项目从未调用过 `ConfigProvider.config`
 * （全仓 0 处）→ `config.theme` 恒为 `undefined` → 深色主题下弹出的是一个
 * 「白底内容区 + 默认蓝按钮」的确认框，与其余自定义底部操作区的弹窗肉眼可辨。
 *
 * 这类回退是**静默**的：浅色主题完全正常，只有切到深色才看得见；靠人眼复查 6 处调用
 * 已经漏过一轮（`message` 都改对了，`Modal` 漏了 —— 范式漂移而非设计选择），
 * 所以把规则固化成测试。
 *
 * 判据三条（对应 deliverable §8.2 G1）：
 *  1. `Modal.confirm|info|success|error|warning|warn(` —— 大写的 `Modal` 是静态命名空间，
 *     唯一的合法入口是小写的 `modal`（来自 `App.useApp()`），二者字面量不同，
 *     所以这条不需要附加条件。
 *  2. `notification.open|success|error|info|warning|warn(` —— **附加条件**：本文件没有
 *     从 `App.useApp()` 解构出 `notification`。原因：`notification` 既是 antd 的静态导出，
 *     也是 `App.useApp()` 的字段名，**字面量完全相同**；`RiskScanWatcher` /
 *     `SuggestionScanWatcher` 用的正是后者（合法写法），不加条件会误报 6 处。
 *     静态用法不会被漏掉——不 `import` 就拿不到静态 `notification`，那由第 3 条拦住。
 *  3. `import { ... message ... } from "antd"` / `... notification ...` —— 从 `antd` 根
 *     具名导入 `message` / `notification` 即失败。`App.useApp()` 解构出来的不算：
 *     那不是 import 语句。
 *
 * 豁免只有一个：命中行里带 `// antd-static-ok: <理由>` 注释则放行。
 * 刻意**不用**外部白名单文件 —— 白名单会腐烂，行内注释把理由钉在调用点，
 * code review 时一眼能审。
 *
 * 扫描范围：`src/**\/*.{ts,tsx}`，排除 `*.test.*` / `*.spec.*` 与 `__tests__` 目录
 * （测试自己需要构造违规样本来验证守卫本身有效）。
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

/** 不扫的目录：测试目录与构建产物。 */
const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage"]);

/** 不扫的文件：测试文件本身。 */
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

/** 规则 1：大写的 `Modal` 静态命名空间（允许 `.` 两侧有空白）。 */
const MODAL_STATIC = /\bModal\s*\.\s*(?:confirm|info|success|error|warning|warn)\s*\(/;

/** 规则 2：`notification` 静态命名空间（仅在文件未从 `App.useApp()` 取用时生效）。
 *
 * 为什么要"仅在未取用时报"：`notification` 既是 antd 的静态导出名，也是
 * `App.useApp()` 的字段名，字面量完全相同，只能靠"本文件有没有解构它"来区分；
 * 静态入口另有规则 3 兜住（不 import 就拿不到静态 notification），所以不会漏报。
 */
const NOTIFICATION_STATIC = /\bnotification\s*\.\s*(?:open|success|error|info|warning|warn)\s*\(/;

/** `const { a, b } = App.useApp()`：取出解构字段名，用于规则 2 的判据。 */
const APP_USE_APP_DESTRUCTURE = /const\s*\{([^}]*)\}\s*=\s*App\s*\.\s*useApp\s*\(\s*\)/g;

/** 从 `antd` 根导入的语句（可能跨行，所以按整个源码匹配而不是逐行）。 */
const ANTD_NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']antd["']/g;

/** 规则 3：这些名字只允许从 `App.useApp()` 拿，不允许从 `antd` 根具名导入。 */
const FORBIDDEN_ANTD_NAMES = new Set(["message", "notification"]);

/** 行内豁免标记：命中行含它即放行（冒号后写理由）。 */
const EXEMPTION_MARKER = "// antd-static-ok:";

interface Violation {
  /** 相对 `src/` 的路径，如 `pages/InterviewPage.tsx`。 */
  file: string;
  /** 1 起的行号。 */
  line: number;
  /** 命中的原文（已 trim，便于在报错里直接定位）。 */
  text: string;
  /** 命中的是哪条规则，便于判断该用哪种改法。 */
  rule: string;
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
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (TEST_FILE_PATTERN.test(entry.name)) continue;
    collected.push(absolute);
  }
  return collected;
}

/** 偏移量 → 1 起的行号。 */
function lineOfOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(CH_NEWLINE).length;
}

/** 本文件从 `App.useApp()` 解构出来的字段名集合。 */
function appUseAppFields(source: string): Set<string> {
  const fields = new Set<string>();
  for (const match of source.matchAll(APP_USE_APP_DESTRUCTURE)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s*:\s*/)[0]
        .trim();
      if (name.length > 0) fields.add(name);
    }
  }
  return fields;
}

/**
 * 找出一个源码文本里的全部违规点。
 *
 * 抽成纯函数是为了第二个测试能喂人造样本来验证「守卫本身有效」——
 * 一条永远匹配不到东西的正则会让守卫看起来是绿的，这比没有守卫更危险。
 */
function collectViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const hasContextNotification = appUseAppFields(source).has("notification");
  const lines = source.split(CH_NEWLINE);

  lines.forEach((text: string, index: number) => {
    if (text.includes(EXEMPTION_MARKER)) return;
    if (MODAL_STATIC.test(text)) {
      violations.push({ file, line: index + 1, text: text.trim(), rule: "Modal.*" });
      return;
    }
    if (!hasContextNotification && NOTIFICATION_STATIC.test(text)) {
      violations.push({ file, line: index + 1, text: text.trim(), rule: "notification.*" });
    }
  });

  // `import` 可能跨行书写（本仓大量文件的 antd 导入是多行的），所以按整段源码匹配，
  // 再把命中位置换算回行号。
  for (const match of source.matchAll(ANTD_NAMED_IMPORT)) {
    if (match[0].includes(EXEMPTION_MARKER)) continue;
    const clause = match[1];
    const clauseStart = (match.index ?? 0) + match[0].indexOf(clause);
    // 按 `,` 切段并用 `matchAll` 拿到每段在 clause 内的偏移：直接 `split` 会丢掉偏移，
    // 而多行导入里"段首的换行"会把行号算早一行。
    for (const part of clause.matchAll(/[^,]+/g)) {
      const raw = part[0];
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const name = trimmed
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (!FORBIDDEN_ANTD_NAMES.has(name)) continue;
      const nameOffset = raw.indexOf(name);
      const offset = clauseStart + (part.index ?? 0) + (nameOffset >= 0 ? nameOffset : 0);
      const line = lineOfOffset(source, offset);
      const text = lines[line - 1] ?? trimmed;
      violations.push({
        file,
        line,
        text: text.trim(),
        rule: `antd 根导入 ${name}`,
      });
    }
  }

  return violations;
}

describe("静态调用守卫", () => {
  it("业务代码不使用 antd 静态方法（Modal.* / notification.* / import { message }）", () => {
    const violations: Violation[] = [];

    for (const absolute of collectSourceFiles(SRC_ROOT)) {
      const file = relative(SRC_ROOT, absolute).split(sep).join("/");
      violations.push(...collectViolations(file, readFileSync(absolute, "utf8")));
    }

    expect(
      violations,
      "这些地方还在用 antd 静态方法（脱离 ConfigProvider，深色主题下会退化成默认浅色 token）。" +
        "请改用 `const { message, modal, notification } = App.useApp();` 解构出的实例；" +
        "确实例外时在该行加 `// antd-static-ok: <理由>`：" +
        CH_NEWLINE +
        violations
          .map((item) => `${item.file}:${item.line}  [${item.rule}]  ${item.text}`)
          .join(CH_NEWLINE),
    ).toEqual([]);
  });

  it("守卫自身能识别三种命中形态，且放行 useApp 与行内豁免", () => {
    // 1. 静态 Modal：无条件命中。
    const modalSample = [
      "export function pick(): void {",
      '  Modal.confirm({ title: "结束这场面试？" });',
      "}",
    ].join(CH_NEWLINE);
    expect(collectViolations("sample/modal.tsx", modalSample)).toEqual([
      {
        file: "sample/modal.tsx",
        line: 2,
        text: 'Modal.confirm({ title: "结束这场面试？" });',
        rule: "Modal.*",
      },
    ]);

    // 2. 静态 notification：文件里没有 App.useApp() 解构 → 命中。
    const notificationSample = 'notification.success({ title: "完成" });';
    expect(
      collectViolations("sample/notification.ts", notificationSample).map((item) => item.rule),
    ).toEqual(["notification.*"]);

    // 3. useApp 解构出来的 notification 是合法写法（RiskScanWatcher / SuggestionScanWatcher）。
    const contextSample = [
      "const { message, notification } = App.useApp();",
      'notification.success({ title: "完成" });',
    ].join(CH_NEWLINE);
    expect(collectViolations("sample/context.tsx", contextSample)).toEqual([]);

    // 3b. 但真的从 antd 根具名导入 notification 的，即使同时有 useApp 解构也要报。
    const notificationImportSample = [
      'import { App, notification } from "antd";',
      "const { modal } = App.useApp();",
    ].join(CH_NEWLINE);
    expect(
      collectViolations("sample/notification-import.tsx", notificationImportSample).map(
        (item) => item.rule,
      ),
    ).toEqual(["antd 根导入 notification"]);

    // 4. 从 antd 根具名导入 message：命中，且跨行导入也要能报。
    const importSample = [
      "import {",
      "  App,",
      "  message,",
      '} from "antd";',
      "const { modal } = App.useApp();",
    ].join(CH_NEWLINE);
    const importViolations = collectViolations("sample/import.tsx", importSample);
    expect(importViolations.map((item) => item.rule)).toEqual(["antd 根导入 message"]);
    expect(importViolations[0].line).toBe(3);

    // 5. 行内豁免标记放行。
    const exemptSample = 'Modal.info({ title: "说明" }); // antd-static-ok: 该模块不在 Provider 内';
    expect(collectViolations("sample/exempt.tsx", exemptSample)).toEqual([]);
  });
});
