// SPDX-License-Identifier: Apache-2.0
/**
 * 模块级 `t()` 不消费 React context。
 *
 * `t()` 读的是 `localeStore` 的当前快照，但组件必须重新渲染才会再求值一次；React 会
 * 跳过引用未变的子树，所以「context 变了」并不能让这些组件更新——组件里必须另有一行
 * `useLocale()`（或 `useI18n()`）订阅 store。
 *
 * 漏掉的表现：切到 English 后，界面大部分变了，这一屏还是中文，而且不报任何错。
 * 所以这里用源码扫描把它变成红测试，而不是等人工走查发现。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但本文件只在 Node（vitest）里跑。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 具名导入 `t`（含与其它符号一起导入）、且来源是 i18n 模块。 */
const MODULE_T_IMPORT = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["'][^"']*i18n["']/;

/** 订阅入口：任一即视为该组件会随语言重新渲染。 */
const SUBSCRIPTION = /\buseLocale\s*\(\s*\)|\buseI18n\s*\(\s*\)/;

/** 只收非测试的 `.tsx`：`.ts` 里的模块级翻译不参与渲染，不需要订阅。 */
function componentSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...componentSources(full));
    else if (entry.name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 组件文件按 React 约定用 PascalCase 命名；小写的 `.tsx` 是本项目的 hook 与
 * 纯函数（`useToast.tsx`、`resumeRowCopyActions.tsx` 这类），它们在里面调 `t()`
 * 是替**调用方**取文案——调用方组件订阅后，hook 会跟着重新执行。
 * 给它们硬加 `useLocale()` 反而会违反 Hooks 规则（在非组件/非 hook 里调 hook）。
 */
function isComponentFile(file: string): boolean {
  const base = file.slice(file.lastIndexOf(sep) + 1, -".tsx".length);
  return /^[A-Z]/u.test(base);
}

describe("模块级 t() 的组件", () => {
  it("都订阅了语言变化（useLocale / useI18n 至少一个）", () => {
    const missing = componentSources(SRC_ROOT)
      .filter(isComponentFile)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return MODULE_T_IMPORT.test(source) && !SUBSCRIPTION.test(source);
      })
      .map((file) => relative(SRC_ROOT, file).split(sep).join("/"))
      .sort();

    expect(missing).toEqual([]);
  });
});
