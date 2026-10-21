// SPDX-License-Identifier: Apache-2.0
/**
 * 「不许自动缩字号」守卫（G4）：全前端不得再出现任何整体缩放。
 *
 * 背景（2026-10-21 用户要求）：此前模板把所有尺寸挂在
 * `:root { --fs: calc(基准 * var(--fit-scale, 1)) }` 上，由一段脚本逐步把 `--fit-scale`
 * 压小，直到正文挤进页数上限。后果是**滑杆上的 18px 不是纸面上的 18px**——用户调的是
 * 18px，看到的是 11px，而且缩到下限 0.5 还放不下时只得到一句"字号已降到最小"。
 * 前端也曾有一条自己的兜底（`layout.ts` 里按内容宽高比写 `--fit-scale`）。
 *
 * 现在的口径：参数就是权威，装不下就标溢出、由界面提示加页 / 收紧版式。这条守卫盯着
 * `src/` 下的可执行代码，防止"顺手加回一个缩放"：
 *
 * 1. 任何源码都不得再写 `--fit-scale`（包括拖动时的即时反馈 CSS，见
 *    `utils/resumeFontScale.ts` —— 模板的 `--fs` 现在就是字面量，探针也必须一致）；
 * 2. `layout.ts` 不得再出现按内容比例算出的 `Math.min(1, 宽比, 高比)` 兜底。
 *
 * 注意 `geometry.ts` 里的 `fitScale` 是**视口缩放**（整张 A4 等比缩到能看见），与这里的
 * "缩字号塞进一页"不是一回事：它等比缩放整张纸，字号/行距/页边距的相对关系分毫不变。
 *
 * 同一条规则在模板侧还有一份（`_resume_fit_script.j2` 不得改字号），由
 * `backend/tests/test_resume_templates.py` 逐模板钉住——两套实现各守各的。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PREVIEW_DIR = dirname(fileURLToPath(import.meta.url));
const LAYOUT_FILE = join(PREVIEW_DIR, "layout.ts");
const SRC_DIR = join(PREVIEW_DIR, "..", "..");

/** `src/` 下所有源码文件（含子目录），排除测试与快照。 */
function sourceFiles(dir: string = SRC_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }) as {
    name: string;
    isDirectory: () => boolean;
  }[]) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.[tj]sx?$/.test(entry.name)) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;
    found.push(full);
  }
  return found;
}

/**
 * 去掉注释再判。
 *
 * 这些文件里**允许**在注释中解释历史（"以前这里写 `--fit-scale`"）——把注释也算进判据，
 * 就会逼着后来人删掉"为什么这么做"的记录。守卫要盯的是**可执行代码**。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("预览与拖动反馈都不再自动缩放", () => {
  it("src 下没有任何源码再写 --fit-scale：字号只能来自版式参数", () => {
    const offenders = sourceFiles()
      .map((file) => ({ file, code: stripComments(readFileSync(file, "utf8")) }))
      .filter(({ code }) => code.includes("--fit-scale"))
      .map(({ file }) => relative(SRC_DIR, file).replace(/\\/g, "/"));
    expect(offenders, "这些文件里又出现了 --fit-scale").toEqual([]);
  });

  it("layout.ts 不再按内容比例压小字号（旧的兜底路径）", () => {
    const code = stripComments(readFileSync(LAYOUT_FILE, "utf8"));
    // 旧实现：`Math.min(1, A4_WIDTH_PX / contentWidth, paperHeight / contentHeight)`
    expect(code).not.toContain("contentScale");
    expect(code).not.toContain("setProperty(");
  });
});
