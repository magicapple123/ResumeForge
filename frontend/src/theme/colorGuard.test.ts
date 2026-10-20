/**
 * 颜色守卫（R18）：业务 CSS 里不允许再出现硬编码的颜色。
 *
 * 为什么需要这条守卫：深色主题能不能用，取决于"有没有人又写死一个 `#fff` 背景"。
 * 这种回退是静默的——浅色主题下完全正常，只有切到深色才会看见一块白。靠人眼复查
 * 数百处色值不现实，所以把规则固化成测试：**新增界面请用 `var(--rf-*)`**。
 *
 * 允许的例外只有三类（都在下面显式列出，新增需要写理由）：
 *  1. `--rf-*` 自定义属性自身的定义——那正是 token 的源头；
 *  2. 白色文字：品牌实底上必须是白字，深色主题下 `--rf-brand-fill` 仍是深底；
 *  3. 掩膜/滤镜/滚动条：不是"画在页面上的颜色"。
 */
import { describe, expect, it } from "vitest";

/** Vite 的 `?raw`：把 CSS 当字符串读进来，测试里不需要 Node 的 fs 类型。 */
const CSS_FILES = import.meta.glob(["../styles/*.css", "../features/tou-tou/*.css"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
import designTokensRaw from "./design-tokens.css?raw";
import darkTokensRaw from "./dark-tokens.css?raw";

/** 允许保留字面量的属性：token 定义本身与"不是画颜色"的属性。 */
const ALLOWED_PROPERTIES = [
  /^--rf-/,
  /^mask-image$/,
  /^-webkit-mask-image$/,
  /^filter$/,
  /^scrollbar-color$/,
  /^box-shadow$/,
  /^text-shadow$/,
];

/** 换行符常量：避免在模板里直接写它，编辑器/工具链来回转义时最容易被吃掉。 */
const CH_NEWLINE = String.fromCharCode(10);

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|rgba?\([^)]*\)/;
const DECLARATION = /^\s*([a-z-]+)\s*:\s*([^;]*);/;

interface Offender {
  file: string;
  line: number;
  text: string;
}

describe("颜色守卫", () => {
  it("业务 CSS 不写死颜色（除白字与图表色）", () => {
    const offenders: Offender[] = [];

    for (const [file, content] of Object.entries(CSS_FILES)) {
      content.split(CH_NEWLINE).forEach((text: string, index: number) => {
        const match = DECLARATION.exec(text);
        if (!match) return;
        const property = match[1];
        if (ALLOWED_PROPERTIES.some((pattern) => pattern.test(property))) return;
        if (!COLOR_LITERAL.test(match[2])) return;
        // 唯一的白字例外：`color: #fff` / `color: #ffffff`。
        if (property === "color" && /^#(fff|ffffff)$/i.test(match[2].trim())) return;
        offenders.push({
          file: file.replace("../", ""),
          line: index + 1,
          text: text.trim(),
        });
      });
    }

    expect(
      offenders,
      "这些声明还在写死颜色，请改用 var(--rf-*)：" +
        CH_NEWLINE +
        offenders.map((item) => `${item.file}:${item.line}  ${item.text}`).join(CH_NEWLINE),
    ).toEqual([]);
  });

  it("深色主题覆盖了所有颜色类 token", () => {
    const light = designTokensRaw;
    const dark = darkTokensRaw;
    const tokens = [...light.matchAll(/^\s*(--rf-[a-z-]+)\s*:/gm)].map(
      (match: RegExpMatchArray) => match[1],
    );

    // 与主题无关的 token（间距、圆角、动效时长、页头高度、弹窗高度上限、层级）
    // 不要求有深色覆盖：它们是**长度**不是颜色，深浅两套主题共用同一个值。
    const colorTokens = tokens.filter(
      (token: string) => !/-space-|-radius-|-duration|-height|-max-h|layer-/i.test(token),
    );
    const missing = colorTokens.filter((token: string) => !dark.includes(`${token}:`));

    expect(missing, `深色主题缺少这些 token：${missing.join(", ")}`).toEqual([]);
  });
});
