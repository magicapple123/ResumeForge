// SPDX-License-Identifier: Apache-2.0
/**
 * 加载出口守卫（G3）：整个 `src/` 里不许再出现 `<Spin spinning={...}>`。
 *
 * 为什么需要这条守卫：全仓加载出口此前是"双轨"——23 处用 `LoadingBlock`，另有 12 处
 * 直接写 `<Spin spinning={loading}>内容</Spin>`。后者不是错，但它是**静默漂移**的入口：
 * 每换一处，尺寸/最小高度/`role="status"` 的语义就少一处，而皮眼看不出差别。
 * 把规则固化成测试，新增界面只能走 `LoadingBlock`。
 *
 * 判据：同一标签上出现 `spinning=` 即违规（要不要遮罩是 `LoadingBlock` 的 `spinning`
 * prop 的事，不该在业务文件里直接对 antd `Spin` 说话）。不带 `spinning` 的裸 `<Spin />`、
 * `<Spin size="small" />`、`<Spin fullscreen />` 不属于本守卫范围——它们是"就地转圈"，
 * 与"整块加载出口"不是一回事（治理见 deliverable §四 P1-1 的分型）。
 *
 * 豁免：
 *  - 文件级白名单只有 `components/common/LoadingBlock.tsx`（它就是那个出口本身）；
 *  - 规则级豁免用行内注释 `spin-ok: <理由>`（JS 里写 `// spin-ok:`，JSX 里写
 *    `{/* spin-ok: … *\/}`；标记里刻意不带 `//`，免得 JSX 写法漏豁免）。
 *    与 G1 的 `antd-static-ok:` 分开，免得"为什么允许"被糊成一句。
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

/** 扫**整个 `src/`**：加载出口可能落在任何一层。
 *
 * 本守卫最初只扫 `components` + `pages`，漏掉了 `src/features/**`（43 个 tsx，含
 * `ai-polish/`、`assistant/`、`tou-tou/`、`webform/`）与 `src/hooks` —— QA 用探针
 * （在 `features/` 下放一个未豁免的 `<Spin spinning={true}>`）证明了那是**静默漏报**：
 * 守卫照样绿。守卫的价值在于"扫不到的地方等于没有规则"，所以改为整树扫描。 */
const SCANNED_ROOT = SRC_ROOT;

/** 不扫的目录：测试目录与构建产物。 */
const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage"]);

/** 不扫的文件：测试文件本身。 */
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

/** 文件级白名单：出口组件自身（它当然要对 antd Spin 说话）。 */
const ALLOWED_FILES = new Set(["components/common/LoadingBlock.tsx"]);

/** 规则级豁免标记：命中标签内含它即放行（冒号后写理由）。 */
const EXEMPTION_MARKER = "spin-ok:";

interface Violation {
  /** 相对 `src/` 的路径，如 `pages/KnowledgePage.tsx`。 */
  file: string;
  /** 1 起的行号（`<Spin` 起始处）。 */
  line: number;
  /** 命中的标签原文（压成一行，便于在报错里直接读）。 */
  text: string;
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

/**
 * 取出 `<Spin ...>` 这个开始标签的原文。
 *
 * 不能用正则 `/<Spin[^>]*>/`：属性表达式里完全可能出现 `>`（`spinning={a > 0}`），
 * 正则会把它截断在错误的位置，从而漏掉后面的 `spinning=` —— 漏报比误报更糟，
 * 因为守卫看起来是绿的。这里按 `{}` 配对 + 引号状态手动扫到真正的标签结束。
 */
function openingTagAt(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

/**
 * 命中处是否带 `// spin-ok: <理由>` 豁免。
 *
 * 查两条线的范围：标签起始行（行内注释写在这里）与标签结束行的行尾
 * （JSX 里更常见的写法是标签后面紧跟 `{/* spin-ok: … *\/}`，它落在标签之外）。
 */
function hasExemption(source: string, tagStart: number, tagEnd: number): boolean {
  const lineStart = source.lastIndexOf(CH_NEWLINE, tagStart - 1) + 1;
  const newlineAfterTag = source.indexOf(CH_NEWLINE, tagEnd);
  const lineEnd = newlineAfterTag === -1 ? source.length : newlineAfterTag;
  return source.slice(lineStart, lineEnd).includes(EXEMPTION_MARKER);
}

/** 找出一个源码文本里所有带 `spinning=` 的 `<Spin` 标签。 */
function collectSpinningTags(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const marker = "<Spin";
  let cursor = source.indexOf(marker);

  while (cursor !== -1) {
    // 排除 `<SpinSomething`（同前缀的其它组件）。
    const following = source[cursor + marker.length] ?? "";
    if (following !== "" && !/[\s/>]/.test(following)) {
      cursor = source.indexOf(marker, cursor + marker.length);
      continue;
    }

    const tag = openingTagAt(source, cursor);
    if (/\bspinning\s*=/.test(tag) && !hasExemption(source, cursor, cursor + tag.length)) {
      violations.push({
        file,
        line: lineOfOffset(source, cursor),
        text: tag.replace(/\s+/g, " ").trim(),
      });
    }
    cursor = source.indexOf(marker, cursor + marker.length);
  }

  return violations;
}

describe("加载出口守卫", () => {
  it("整个 src/ 都不出现 <Spin spinning={...}>，改用 LoadingBlock", () => {
    const violations: Violation[] = [];

    for (const absolute of collectSourceFiles(SCANNED_ROOT)) {
      const file = relative(SRC_ROOT, absolute).split(sep).join("/");
      if (ALLOWED_FILES.has(file)) continue;
      violations.push(...collectSpinningTags(file, readFileSync(absolute, "utf8")));
    }

    expect(
      violations,
      "这些地方还在用 <Spin spinning={...}>。请改用同目录相对路径的 LoadingBlock，" +
        "把原表达式透传给它的 spinning prop（`<LoadingBlock spinning={loading}>…</LoadingBlock>`）；" +
        "确实例外时在该行加 `spin-ok: <理由>` 注释：" +
        CH_NEWLINE +
        violations.map((item) => `${item.file}:${item.line}  ${item.text}`).join(CH_NEWLINE),
    ).toEqual([]);
  });

  it("守卫自身能识别 spinning 标签，且放行裸 Spin 与行内豁免", () => {
    // 1. `spinning=` 命中。
    const spinningSample = [
      "export function Card(): ReactNode {",
      "  return (",
      "    <Spin spinning={loading}>",
      "      <div>内容</div>",
      "    </Spin>",
      "  );",
      "}",
    ].join(CH_NEWLINE);
    expect(collectSpinningTags("sample/card.tsx", spinningSample)).toEqual([
      { file: "sample/card.tsx", line: 3, text: "<Spin spinning={loading}>" },
    ]);

    // 2. 属性表达式里带 `>` 也要能扫到（正则截断会漏报）。
    const comparisonSample = '<Spin spinning={count > 0} size="small" />';
    expect(collectSpinningTags("sample/compare.tsx", comparisonSample)).toHaveLength(1);

    // 3. 裸 Spin / size="small" / fullscreen 不属本守卫范围。
    const bareSample = [
      "<Spin />",
      '<Spin size="small" />',
      "<Spin fullscreen />",
      '<Spin tip="加载中可以 > 停">',
    ].join(CH_NEWLINE);
    expect(collectSpinningTags("sample/bare.tsx", bareSample)).toEqual([]);

    // 4. 行内豁免标记放行。
    const exemptSample = "<Spin spinning={loading}> {/* spin-ok: 该处需要就地遮罩而非整块出口 */}";
    expect(collectSpinningTags("sample/exempt.tsx", exemptSample)).toEqual([]);

    // 5. 扫描面必须是**整个 src/**：守卫曾只扫 components/ + pages/，于是
    //    features/（43 个 tsx）与 hooks/ 里的违规完全扫不到（QA 用探针证明过）。
    const scanned = collectSourceFiles(SCANNED_ROOT).map((absolute) =>
      relative(SRC_ROOT, absolute).split(sep).join("/"),
    );
    expect(scanned.some((file) => file.startsWith("features/"))).toBe(true);
    expect(scanned.some((file) => file.startsWith("hooks/"))).toBe(true);
    // 同一份真实扫描面里，LoadingBlock 自身仍在（它靠白名单放行，不是靠漏扫）。
    expect(scanned).toContain("components/common/LoadingBlock.tsx");
  });
});
