// SPDX-License-Identifier: Apache-2.0
/**
 * R-19 的删除守卫：格式刷不许"复活"。
 *
 * 为什么用"读文件文本"而不是渲染断言：这条路被删掉之后，任何一条渲染断言都只能证明
 * "当前没渲染"，证明不了"代码里没有又冒出来一份"。而这类功能最容易以三种方式回归：
 * ① 有人把组件/规则层文件加回来；② 有人重新 import 那两个模块；③ 有人恢复文案键。
 * 三条都在这里钉住（与 `styles/color-regression.test.ts` 同一手法：直接读源文件——
 * Vitest 会把未列入 `test.css.include` 的资产替换成空模块，`?raw` 拿到的是空串）。
 *
 * 「固定这条的当前样式」不在删除范围内：它的规则搬到了 `features/resume-layout/styleFreeze`，
 * 文案键 `typography.painter.freeze*` 仍然存在。这里同时确认它**没有被误删**。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

const SRC = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(SRC);
const sourceFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const zh = readFileSync(`${SRC}/i18n/messages/zh-CN.typography.ts`, "utf8");
const en = readFileSync(`${SRC}/i18n/messages/en-US.typography.ts`, "utf8");

describe("格式刷已删除且不得回归", () => {
  it("组件与规则层文件不存在", () => {
    expect(existsSync(`${SRC}/components/resume/typography/FormatPainterButton.tsx`)).toBe(false);
    expect(existsSync(`${SRC}/features/resume-layout/stylePainter.ts`)).toBe(false);
  });

  it("没有任何生产代码 import 它们", () => {
    const offenders = sourceFiles.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /FormatPainterButton|features\/resume-layout\/stylePainter/.test(text);
    });
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("专属文案键已清除，freeze 三个键保留", () => {
    for (const key of [
      "typography.painter.title",
      "typography.painter.hint",
      "typography.painter.copy",
      "typography.painter.copyProps",
      "typography.painter.propSeparator",
      "typography.painter.empty",
      "typography.painter.armed",
      "typography.painter.apply",
      "typography.painter.cancel",
      "typography.painter.applied",
    ]) {
      expect(zh).not.toContain(`"${key}"`);
      expect(en).not.toContain(`"${key}"`);
    }
    for (const key of [
      "typography.painter.freeze",
      "typography.painter.freezeHint",
      "typography.painter.frozen",
    ]) {
      expect(zh).toContain(`"${key}"`);
      expect(en).toContain(`"${key}"`);
    }
  });

  it("「固定这条的当前样式」的规则层仍在", () => {
    const freeze = readFileSync(`${SRC}/features/resume-layout/styleFreeze.ts`, "utf8");
    expect(freeze).toContain("export function freezeObjectStyle");
    expect(freeze).toContain("export function freezeObjectRoleStyle");
  });
});
