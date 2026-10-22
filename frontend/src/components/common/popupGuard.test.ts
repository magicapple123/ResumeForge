// SPDX-License-Identifier: Apache-2.0
/**
 * 弹层守卫 P1 / P2 / P4（见方案 §6.1）：
 *
 * | 编号 | 断言 |
 * | --- | --- |
 * | P1 | 文件里同时有 `<Form` 与 `<Modal` → 每个 `<Modal>` 必须 `maskClosable={false}` |
 * | P2 | 每个 `<Modal>` 必须自带 `footer={` 或 `okText=`（不许让 antd 生成「确定/取消」） |
 * | P4 | `<Drawer>` 不许用 `width=`（统一 `size=`） |
 *
 * 三条都只能靠**行内豁免注释**放行：`// popup-ok: <理由>`。刻意不建白名单文件——
 * 白名单会腐烂，行内注释把理由钉在调用点，review 时一眼能审。
 *
 * ## 为什么不用 `[^>]*` 匹配标签
 *
 * `<Modal styles={{ body: { maxHeight: … } }}>` 里有多层大括号，`[^>]*` 遇不到 `>` 就一路
 * 吞到下一个标签；而 `=>` 里的 `>` 又会提前截断。所以这里用**大括号 + 引号配平的扫描器**
 * 读一个标签，自测夹具直接喂一段真实的 `<Modal>` 片段。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSourceFiles } from "../../i18n/cjkScan";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 豁免标记。冒号后**必须**写理由。 */
export const EXEMPTION_MARKER = "// popup-ok:";

/**
 * 禁蒙层关闭的两种合法写法。
 *
 * `maskClosable` 在 antd 6.6.5 已废弃（`modal/interface.d.ts:71`），新写法是
 * `mask={{ closable: false }}`；旧写法仍兼容，所以守卫两种都认。
 */
const MASK_OFF = /maskClosable=\{false\}|mask=\{\{\s*closable:\s*false\s*\}\}/;

export interface PopupViolation {
  file: string;
  /** 1 起的行号。 */
  line: number;
  rule: "P1" | "P2" | "P4";
  text: string;
}

/**
 * 从 `<Modal` / `<Drawer` 的起始偏移读到一个完整标签。
 *
 * 配平三类"会吃掉 `>` 的东西"：字符串（`'` `"` `` ` ``）、大括号（`{}`）、注释（`//`）。
 * 读不到闭合时退回到"从起点往后 800 字"——宁可多报一处让人看一眼，也不要静默漏掉。
 */
export function readJsxTag(source: string, start: number): string {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index);
      if (newline < 0) break;
      index = newline;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start, start + 800);
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function isExempt(lines: string[], line: number): boolean {
  const marker = EXEMPTION_MARKER;
  const reasonOf = (text: string): boolean => {
    const index = text.indexOf(marker);
    if (index < 0) return false;
    return text.slice(index + marker.length).trim().length > 0;
  };
  return reasonOf(lines[line - 1] ?? "") || reasonOf(lines[line - 2] ?? "");
}

/** 找出一个文件里的 P1/P2/P4 违规。纯函数，便于用人造样本自测。 */
export function collectViolations(file: string, source: string): PopupViolation[] {
  const lines = source.split("\n");
  const violations: PopupViolation[] = [];
  const hasForm = /<Form\b/.test(source);

  for (const match of source.matchAll(/<(Modal|Drawer)(?=[\s>])/g)) {
    const start = match.index ?? 0;
    const tag = readJsxTag(source, start);
    const line = lineOf(source, start);
    if (isExempt(lines, line)) continue;
    const text = (lines[line - 1] ?? tag).trim();
    if (match[1] === "Drawer") {
      if (/\bwidth\s*=/.test(tag)) violations.push({ file, line, rule: "P4", text });
      continue;
    }
    // 新增的 L2 底座不叫 Modal，只有裸 `<Modal>` 才受这两条约束。
    if (hasForm && !MASK_OFF.test(tag)) {
      violations.push({ file, line, rule: "P1", text });
    }
    if (!/footer=\{/.test(tag) && !/\bokText=/.test(tag)) {
      violations.push({ file, line, rule: "P2", text });
    }
  }
  return violations;
}

function scanRepo(): PopupViolation[] {
  const violations: PopupViolation[] = [];
  for (const absolute of collectSourceFiles(SRC_ROOT)) {
    const file = relative(SRC_ROOT, absolute).split(sep).join("/");
    violations.push(...collectViolations(file, readFileSync(absolute, "utf8")));
  }
  return violations;
}

function format(violations: PopupViolation[]): string {
  return violations
    .map((item) => `${item.file}:${item.line} [${item.rule}] ${item.text}`)
    .join("\n");
}

describe("解析器自测（不读仓库）", () => {
  it("带多层大括号与箭头函数的标签能被完整读到", () => {
    const source = [
      "<Modal",
      "  open={open}",
      "  styles={{ body: { maxHeight: '40vh', overflowY: 'auto' } }}",
      "  onCancel={() => setOpen(false)}",
      ">",
    ].join("\n");
    const tag = readJsxTag(source, 0);
    expect(tag.endsWith(">")).toBe(true);
    expect(tag).toContain("overflowY");
    expect(tag).toContain("onCancel");
  });

  it("字符串里的 `>` 不会提前截断标签", () => {
    const source = '<Modal title="a > b" open={open}>';
    expect(readJsxTag(source, 0)).toBe(source);
  });

  it("P1/P2/P4 各自命中，行内豁免放行", () => {
    const formSource = ["<Form>", '  <Modal open={open} title="x">body</Modal>', "</Form>"].join(
      "\n",
    );
    expect(collectViolations("a.tsx", formSource).map((item) => item.rule)).toEqual(["P1", "P2"]);

    const compliant = [
      "<Form>",
      "  <Modal open={open} maskClosable={false} footer={null}>body</Modal>",
      "</Form>",
    ].join("\n");
    expect(collectViolations("b.tsx", compliant)).toEqual([]);

    const drawer = "<Drawer open={open} width={720}>x</Drawer>";
    expect(collectViolations("c.tsx", drawer).map((item) => item.rule)).toEqual(["P4"]);

    const exempt = [
      "<Form>",
      "  // popup-ok: 只读预览，关闭无损失",
      "  <Modal open={open}>body</Modal>",
      "</Form>",
    ].join("\n");
    expect(collectViolations("d.tsx", exempt)).toEqual([]);
  });

  it("没有 <Form 的文件不受 P1 约束，但仍受 P2 约束", () => {
    const readOnly = "<Modal open={open}>x</Modal>";
    expect(collectViolations("e.tsx", readOnly).map((item) => item.rule)).toEqual(["P2"]);
  });
});

describe("弹层形态守卫", () => {
  it("P4：Drawer 统一用 size，不用 width", () => {
    const violations = scanRepo().filter((item) => item.rule === "P4");
    expect(violations, `Drawer 的宽档统一用 size：\n${format(violations)}`).toEqual([]);
  });

  it("P1：含表单的 Modal 必须禁蒙层关闭（B2 启用）", () => {
    const violations = scanRepo().filter((item) => item.rule === "P1");
    expect(violations, format(violations)).toEqual([]);
  });

  it("P2：Modal 必须自带 footer 或描述结果的 okText（B2 启用）", () => {
    const violations = scanRepo().filter((item) => item.rule === "P2");
    expect(violations, format(violations)).toEqual([]);
  });
});
