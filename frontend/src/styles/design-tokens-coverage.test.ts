// SPDX-License-Identifier: Apache-2.0
/**
 * 设计 token 覆盖守卫（审计 R-15）。
 *
 * 背景：2026-10-31 排查发现结构树、条目字段排版、制作台外壳三处共 35 个
 * `var(--rf-color-*)` —— 那个变量族**从来没有定义过**。`var()` 找不到变量时整条声明
 * 失效（不是回退到默认值），于是 hover 没有底色、选中态没有底、树容器没有外框，
 * 而 CSS 本身"看起来是对的"，任何快照/类名断言都抓不到。
 *
 * 这条守卫把口径钉在**文件文本**上而不是计算样式：`getComputedStyle` 在 jsdom 里对
 * 自定义属性一律返回空串（无论定义与否），拿它当判据会永远绿。
 *
 * 三条断言：
 * 1. 全仓 CSS / TSX 里 `var(--x)`（**没有 fallback** 的那种）引用的变量，必须在某处定义过；
 * 2. `--rf-color-*` 不得复活（它是这轮被替换掉的伪族名）；
 * 3. 新增的四个语义 token 在两个主题文件里同名同序都存在。
 *
 * 为什么允许 `var(--x, fallback)`：那是有意降级（旧报告里 `--rf-error-border` 等就是
 * 这么写的），缺失时行为可预期；真正危险的是"以为有、其实没有"的无 fallback 引用。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

const SRC = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(SRC);
const cssFiles = allFiles.filter((f) => f.endsWith(".css"));
const tsFiles = allFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

/** 注释里的 `var(--rf-*)` 是文档说明，不是引用——必须剔掉，否则守卫会误报。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const defined = new Set<string>();
const usedWithoutFallback = new Map<string, string[]>();

const cssSources = cssFiles.map((file) => ({
  file,
  text: stripComments(readFileSync(file, "utf8")),
}));

for (const { file, text } of cssSources) {
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(match[1]);
  for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
    const name = match[1];
    usedWithoutFallback.set(name, [...(usedWithoutFallback.get(name) ?? []), file]);
  }
}

// 组件通过内联 style / setProperty 注入的自定义属性，量不到"定义"就只能误报。
for (const file of tsFiles) {
  const text = stripComments(readFileSync(file, "utf8"));
  for (const match of text.matchAll(/["'](--[a-z0-9-]+)["']\s*:/gi)) defined.add(match[1]);
  for (const match of text.matchAll(/setProperty\(\s*["'](--[a-z0-9-]+)["']/gi))
    defined.add(match[1]);
}

describe("设计 token 覆盖：没有引用不存在的变量", () => {
  it("无 fallback 的 var() 全部有定义", () => {
    const missing = [...usedWithoutFallback.entries()]
      .filter(([name]) => !defined.has(name))
      .map(
        ([name, files]) =>
          `${name} ← ${[...new Set(files)].map((f) => f.slice(SRC.length + 1)).join(", ")}`,
      );
    expect(missing).toEqual([]);
  });

  it("不存在的 --rf-color-* 变量族不得复活", () => {
    const offenders = cssSources
      .filter(({ text }) => /--rf-color-/.test(text))
      .map(({ file }) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe("新增 token 在浅色/深色两套里同名同序", () => {
  const light = stripComments(readFileSync(`${SRC}/theme/design-tokens.css`, "utf8"));
  const dark = stripComments(readFileSync(`${SRC}/theme/dark-tokens.css`, "utf8"));
  const added = [
    "--rf-fill-secondary",
    "--rf-fill-tertiary",
    "--rf-fill-quaternary",
    "--rf-error-bg",
  ];

  it.each(added)("%s 两个主题都有定义", (name) => {
    expect(light).toContain(`${name}:`);
    expect(dark).toContain(`${name}:`);
  });

  it("四个 token 的先后顺序两套一致", () => {
    // 只比相对次序：绝对偏移因注释长度不同而不同。
    const rank = (css: string) =>
      added.slice().sort((a, b) => css.indexOf(`${a}:`) - css.indexOf(`${b}:`));
    for (const name of added) expect(rank(light)).toContain(name);
    expect(rank(dark)).toEqual(rank(light));
  });
});
