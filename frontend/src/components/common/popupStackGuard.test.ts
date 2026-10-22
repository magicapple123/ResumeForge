// SPDX-License-Identifier: Apache-2.0
/**
 * 叠层守卫 P3（方案 §6.2）：**弹层文件里不许再开 `modal.confirm`**。
 *
 * 判据用**文件名**而不是内容：静态分析无法可靠判断"这个 `modal.confirm` 调用点是不是在
 * `<Modal>` 的 JSX 子树里"，而文件名是零成本、零误报的代理判据——页面文件
 * （`JobsPage.tsx`）里的 `modal.confirm` 天然合法，弹层文件里的天然违规。
 *
 * 替代品（按性质三选一，见 `AGENTS.md`）：
 * - 丢弃未保存 → footer 的内联确认条（`FormModal` / 自行实现两态 footer）；
 * - 覆盖类 → 就地 `Popconfirm`（Popover 形态，不占容器层级）；
 * - 警告后继续 → 页内 `Alert` + 按钮。
 *
 * 唯一豁免形式：`// popup-stack-ok: <理由>`（写在调用行或上一行）。
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

export const EXEMPTION_MARKER = "// popup-stack-ok:";

/** 弹层文件：以 `Modal.tsx` / `Drawer.tsx` 结尾的组件文件。 */
const OVERLAY_FILE = /(?:Modal|Drawer)\.tsx$/;

const CONFIRM_CALL = /modal\.confirm\s*\(/;

export interface StackViolation {
  file: string;
  /** 1 起的行号。 */
  line: number;
  text: string;
}

function hasExemption(line: string, previous?: string): boolean {
  const reasonOf = (text: string | undefined): boolean => {
    if (!text) return false;
    const index = text.indexOf(EXEMPTION_MARKER);
    if (index < 0) return false;
    return text.slice(index + EXEMPTION_MARKER.length).trim().length > 0;
  };
  return reasonOf(line) || reasonOf(previous);
}

/** 纯函数：便于用人造样本自测「守卫本身有效」。 */
export function collectViolations(file: string, source: string): StackViolation[] {
  if (!OVERLAY_FILE.test(file)) return [];
  const lines = source.split("\n");
  const violations: StackViolation[] = [];
  lines.forEach((text, index) => {
    if (!CONFIRM_CALL.test(text)) return;
    if (hasExemption(text, lines[index - 1])) return;
    violations.push({ file, line: index + 1, text: text.trim() });
  });
  return violations;
}

describe("叠层守卫", () => {
  it("P3：弹层文件（*Modal.tsx / *Drawer.tsx）内不使用 modal.confirm", () => {
    const violations: StackViolation[] = [];
    for (const absolute of collectSourceFiles(SRC_ROOT)) {
      const file = relative(SRC_ROOT, absolute).split(sep).join("/");
      violations.push(...collectViolations(file, readFileSync(absolute, "utf8")));
    }
    expect(
      violations,
      "弹层里再开 confirm 就是第二层容器（3300）。改用 footer 内联确认条 / 就地 Popconfirm / 页内 Alert：" +
        "\n" +
        violations.map((item) => `${item.file}:${item.line}  ${item.text}`).join("\n"),
    ).toEqual([]);
  });

  it("守卫自身能识别违规、放行页面文件与行内豁免", () => {
    const bad = ["export function A() {", '  modal.confirm({ title: "x" });', "}"].join("\n");
    expect(collectViolations("components/FooModal.tsx", bad)).toHaveLength(1);
    expect(collectViolations("components/FooDrawer.tsx", bad)).toHaveLength(1);

    // 页面里的 confirm 合法：它不是弹层。
    expect(collectViolations("pages/JobsPage.tsx", bad)).toEqual([]);

    const exempt = [
      "  // popup-stack-ok: 批次完成打断（用户等了很久，打断是目的）",
      '  modal.confirm({ title: "x" });',
    ].join("\n");
    expect(collectViolations("components/FooModal.tsx", exempt)).toEqual([]);
  });
});
