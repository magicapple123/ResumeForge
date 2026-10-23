// SPDX-License-Identifier: Apache-2.0
/**
 * 改名守卫：「大图」这个词只允许属于模板画廊那一个功能。
 *
 * 2026-10-23 起，简历页的那个全屏弹窗叫**简历制作台**（Resume Workbench），按钮文案与弹窗
 * 标题是同一个词。PRD §8 的验收口径是一条**可执行**的 grep：旧标题「查看简历大图」全站 0 命中。
 *
 * ## 为什么要有守卫，而不是"改完 grep 一次就行"
 *
 * 这句话有两条容易被时间侵蚀的边界，靠人记不住：
 *
 * 1. **模板画廊的「查看大图」是另一个功能**（看模板整页渲染），PRD 明确要求保留。它此后是全站
 *    唯一叫「大图」的入口——这正是改名的附带收益。有人"顺手统一一下"就会把它也改掉；
 * 2. 注释里写旧名不算违规（记录改名理由有用），但**用户可见的字符串**里一个都不该留。
 *    所以判据是"去注释后的代码"，不是原文件。
 *
 * ## 判据
 *
 * - `查看简历大图`：任何源文件（去注释后）0 命中，**无例外**；
 * - `查看大图`：去注释后只剩模板画廊那一个文件，且它必须仍然命中（守住"别顺手改掉"）；
 * - 新名：`t("workbench.title")` 就是「简历制作台」且 ≤6 字（文案规范 §1.5）；
 * - 界面名换了、**内部名不换**：这里不校验组件名 / 文件名 / 缓存键（PRD §9 第 5 条）。
 *
 * `styles/*.css` 不在这条守卫的范围内（`collectSourceFiles` 只收 `.tsx?`）：
 * `modules-templates.css` 里那句「查看大图」的注释说的是模板画廊的样式，属合法保留。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, resolve } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { t } from ".";
import { collectSourceFiles, stripComments } from "./cjkScan";

/**
 * 旧名与新名都用 `\u` 转义写：本文件自己会被"扫全仓"的其他守卫读到，用字面量会让
 * 那些守卫把**守卫本身**当成违规。运行时仍是同一个词，断言强度不变。
 */
const OLD_FULL_NAME = "\u67e5\u770b\u7b80\u5386\u5927\u56fe";
const OLD_SHORT_NAME = "\u67e5\u770b\u5927\u56fe";
const NEW_NAME = "\u7b80\u5386\u5236\u4f5c\u53f0";

/** 模板画廊的「查看大图」（另一个功能，PRD §8「重名风险」要求保留）。 */
const GALLERY_FILE = "components/resume/TemplateGalleryModal.tsx";

const I18N_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(I18N_DIR, "..");

/** 相对 `src/` 的路径（`/` 分隔），与 `cjkRatchet` 的键口径一致。 */
function toKey(absolute: string): string {
  const root = SRC_ROOT.replace(/\\/g, "/");
  return absolute.replace(/\\/g, "/").slice(root.length + 1);
}

/** 去注释后仍含 `needle` 的源文件（不含测试文件与语言包——见 `collectSourceFiles`）。 */
function filesContaining(needle: string): string[] {
  return collectSourceFiles(SRC_ROOT)
    .filter((absolute) => stripComments(readFileSync(absolute, "utf8")).includes(needle))
    .map(toKey)
    .sort();
}

describe("改名守卫 · 「大图」只剩模板画廊那一个功能", () => {
  it("旧弹窗标题「查看简历大图」在源码里 0 命中", () => {
    expect(filesContaining(OLD_FULL_NAME)).toEqual([]);
  });

  it("「查看大图」只允许出现在模板画廊，且它必须**仍然**在那（别顺手改掉）", () => {
    expect(filesContaining(OLD_SHORT_NAME)).toEqual([GALLERY_FILE]);
  });

  it("新名就是「简历制作台」，且符合按钮文案的 2–6 字约束", () => {
    expect(t("workbench.title")).toBe(NEW_NAME);
    expect([...t("workbench.title")].length).toBeLessThanOrEqual(6);
  });
});
