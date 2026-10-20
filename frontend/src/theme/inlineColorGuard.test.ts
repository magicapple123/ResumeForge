// SPDX-License-Identifier: Apache-2.0
/**
 * 内联样式颜色守卫（R18）：`style={{ ... }}` 里不允许再写死颜色。
 *
 * 与 `colorGuard.test.ts`（管 CSS 文件）互补：那条管 `.css`，这条管组件里的内联样式。
 * 深色主题下最典型的故障就是某处 `style={{ background: "#fff" }}`——浅色主题完全正常，
 * 切到深色后弹窗里出现一块白砖，而靠人眼复查 100+ 处内联色值不现实。
 *
 * 规则只有一条：`style={{ ... }}` 对象里出现 `#rgb` / `#rrggbb` / `rgba(...)` 即失败。
 * **例外必须逐条登记并写理由**（见 `INLINE_COLOR_EXCEPTIONS`）：白名单是"已经想清楚
 * 为什么这里不能换 token"，不是"先绿了再说"。
 *
 * 刻意**只**扫 `style={{...}}`：
 *  - 变量里的色板（图表色等）不是内联样式，靠 `chartPalette` 的深/浅两套统一治理；
 *  - 全面禁止十六进制会把 antd 的 props（如 `stroke`）也误伤，规则就没人愿意用了。
 */
import { describe, expect, it } from "vitest";

/** Vite 的 `?raw`：把源码当字符串读进来，测试里不需要 Node 的 fs 类型。 */
const SOURCE_FILES = import.meta.glob(["../**/*.ts", "../**/*.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 颜色字面量：`#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)`。 */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|rgba?\([^)]*\)/;

/**
 * 与 CSS 守卫同一口径的属性例外：这些属性里的颜色**不是"画在页面上的颜色"**，
 * 换 token 反而会把"阴影浓度/掩膜形状"和主题绑错。
 * （`styles/*.css` 的 `colorGuard.test.ts` 对 box-shadow / filter / mask 已是同一处理。）
 */
const NOT_PAINTED_PROPERTIES = [
  /^boxShadow$/,
  /^textShadow$/,
  /^filter$/,
  /^maskImage$/,
  /^WebkitMaskImage$/,
  /^scrollbarColor$/,
];

/**
 * 逐条例外（值级）。字段含义：
 *  - `file`：相对 `src/` 的路径（与 glob key 去掉 `../` 后一致）；
 *  - `property`：内联样式属性名（正则）；
 *  - `value`：允许的字面量（正则）。
 * 每条都必须写 `reason`：**没有理由的例外就是"还没处理"**。
 *
 * 当前为空：38 处历史硬编码已全部改成 `var(--rf-*)` / `chartPalette` / 主题色板。
 * 新增条目请先问自己"这真的不能换 token 吗"，并把答案写进 `reason`。
 */
interface InlineColorException {
  file: string;
  property: RegExp;
  value: RegExp;
  reason: string;
}

const INLINE_COLOR_EXCEPTIONS: InlineColorException[] = [];

/** 不扫的路径：token 的定义源头、测试文件、构建产物。 */
const EXCLUDED_PATTERNS = [
  // token 源文件本身就是色值定义处（与 CSS 侧 --rf-* 的定义同一个道理）。
  /^theme\/tokens\.ts$/,
  /^theme\/appTheme\.ts$/,
  // 本文件自己也写着正则与说明。
  /^theme\/inlineColorGuard\.test\.ts$/,
  /\.test\.tsx?$/,
  /^test\//,
];

/** 要扫的内联样式入口：`style={{…}}` 与 antd 的 `styles={{…}}`（语义化分段样式）。 */
const STYLE_MARKERS = ["style={{", "styles={{"];

interface Offender {
  file: string;
  line: number;
  property: string;
  value: string;
}

/**
 * 抽出 `style={{ ... }}` 的花括号区间。
 *
 * 用花括号配对而不是正则，是因为样式对象里常常嵌套 `{...}`（如 `margin: {0}`、
 * 三元里的对象字面量）；正则会把区间截断在第一个 `}`，从而漏报——漏报比误报更糟，
 * 因为它会让守卫看起来是绿的。
 */
function styleRegions(source: string): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  for (const marker of STYLE_MARKERS) {
    let cursor = source.indexOf(marker);
    while (cursor !== -1) {
      const start = cursor + marker.length - 1; // 指向 marker 里的最后一个 "{"
      let depth = 0;
      let quote: string | null = null;
      let index = start;
      for (; index < source.length; index += 1) {
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
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      regions.push({ start, end: Math.min(index + 1, source.length) });
      cursor = source.indexOf(marker, index + 1);
    }
  }
  return regions;
}

/** 属性取值：`background: "#fff"`、`borderColor: tone ?? "#ccc"` 都能取到。 */
const PROPERTY_VALUE = /([A-Za-z_$][\w$]*)\s*:\s*("[^"]*"|'[^']*'|`[^`]*`|[^,}]+)/g;

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

describe("内联样式颜色守卫", () => {
  it("style={{...}} 里不写死颜色（例外逐条登记）", () => {
    const offenders: Offender[] = [];

    for (const [key, source] of Object.entries(SOURCE_FILES)) {
      const file = key.replace("../", "");
      if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(file))) continue;

      for (const region of styleRegions(source)) {
        const block = source.slice(region.start, region.end);
        for (const match of block.matchAll(PROPERTY_VALUE)) {
          const property = match[1];
          const value = match[2].trim();
          if (!COLOR_LITERAL.test(value)) continue;
          if (NOT_PAINTED_PROPERTIES.some((pattern) => pattern.test(property))) continue;
          const allowed = INLINE_COLOR_EXCEPTIONS.some(
            (exception) =>
              exception.file === file &&
              exception.property.test(property) &&
              exception.value.test(value),
          );
          if (allowed) continue;
          offenders.push({
            file,
            line: lineOf(source, region.start + (match.index ?? 0)),
            property,
            value,
          });
        }
      }
    }

    expect(
      offenders,
      "这些内联样式还在写死颜色，请改用 var(--rf-*) 或 chartPalette：" +
        String.fromCharCode(10) +
        offenders
          .map((item) => `${item.file}:${item.line}  ${item.property}: ${item.value}`)
          .join(String.fromCharCode(10)),
    ).toEqual([]);
  });

  it("例外清单每条都写了理由（防空话式白名单）", () => {
    const vague = new Set(["", "todo", "tbd", "暂缓", "待定", "later", "wip"]);
    for (const exception of INLINE_COLOR_EXCEPTIONS) {
      expect(exception.reason.trim().length, `${exception.file} 的例外缺理由`).toBeGreaterThan(8);
      expect(vague.has(exception.reason.trim().toLowerCase())).toBe(false);
    }
  });
});
