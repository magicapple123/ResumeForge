/**
 * 颜色回归（B）：把"装饰图标必须用强调色"钉死，防止再次被换成正文色。
 *
 * 上一轮把收藏星标从 `#f5a623` 改成 `--rf-warning-text`（浅色下 `#875300` 深棕），
 * 又把岗位详情、助手会话旗标的彩色图标换成了 `--rf-text-body`：浅色下只是"变灰"，
 * 深色下则与背景糊成一块。这类回归肉眼很难在几十个页面里一次看全，所以按选择器
 * 立规矩——**装饰性颜色（星标/分区图标/旗标）不许使用正文或警示文字 token**。
 *
 * 为什么直接读文件而不是 `?raw`：Vitest 会把未列入 `test.css.include` 的 CSS
 * 替换成空模块，`?raw` 拿到的也是空串（实测），断言会在"空文本"上永远通过。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readCss(...segments: string[]): string {
  return readFileSync([process.cwd(), "src", ...segments].join("/"), "utf8");
}

const designTokensRaw = readCss("theme", "design-tokens.css");
const jobsRaw = readCss("styles", "jobs.css");
const assistantLayoutRaw = readCss("styles", "assistant-layout.css");
const assistantContentRaw = readCss("styles", "assistant-content.css");

/** 取某条选择器的声明块；找不到直接抛错（改名/删规则时测试会立刻红）。 */
function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`CSS 中找不到规则：${selector}`);
  return match[1];
}

describe("颜色回归：装饰色不被正文色取代", () => {
  it("收藏星标使用 --rf-favorite（浅色 #f5a623）", () => {
    expect(designTokensRaw).toContain("--rf-favorite: #f5a623;");
    const block = ruleBlock(jobsRaw, ".job-favorite-button.is-favorite");
    expect(block).toContain("var(--rf-favorite)");
    expect(block).not.toContain("--rf-warning-text");
    expect(block).not.toContain("--rf-text-body");
  });

  it("岗位详情分区图标各自使用强调色", () => {
    // 描述分区用基础规则（--rf-info），其余三个分区各自覆盖。
    const sections: [string, string][] = [
      [".job-detail-section-icon", "--rf-info"],
      [".job-detail-text-section--requirements .job-detail-section-icon", "--rf-accent-violet"],
      [".job-detail-text-section--additional .job-detail-section-icon", "--rf-accent-green"],
      [".job-detail-text-section--note .job-detail-section-icon", "--rf-accent-amber"],
    ];
    for (const [selector, token] of sections) {
      const block = ruleBlock(jobsRaw, selector);
      expect(block, `${selector} 应使用 ${token}`).toContain(`var(${token})`);
      expect(block, `${selector} 不应退回正文色`).not.toContain("--rf-text-body");
    }
  });

  it("助手会话旗标使用收藏琥珀色", () => {
    const block = ruleBlock(assistantLayoutRaw, ".assistant-conversation-flags");
    expect(block).toContain("var(--rf-favorite)");
    expect(block).not.toContain("--rf-warning-text");
  });

  it("助手富文本链接 hover 保持链接色而不是正文色", () => {
    const block = ruleBlock(assistantContentRaw, ".assistant-message-content--rich a:hover");
    expect(block).toContain("var(--rf-info-strong)");
    expect(block).not.toContain("--rf-text-body");
  });
});

/**
 * T9：求职进度的样式里不再写字面量颜色。
 *
 * 上一版把阶段色写成 `#5b8ff9` 并在两处各抄了一遍，深色主题下既没有对应值、也改不动
 * （改一处漏一处）。现在阶段色只存在于 `--rf-stage-*`（两套主题各一份），这条守卫
 * 保证它不会悄悄长回去。唯一的例外是白字 `color: #fff`——它压在品牌实底/阶段色块上，
 * 深浅两套主题都是浅色。
 */
describe("颜色回归：求职进度不写字面量颜色（T9）", () => {
  const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;
  const WHITE_TEXT = /^\s*color:\s*#(fff|ffffff);?\s*$/;

  it("tracker.css 里除白字外没有 hex 字面量", () => {
    const offenders = readCss("styles", "tracker.css")
      .split("\n")
      .map((text, index) => ({ text: text.trim(), line: index + 1 }))
      .filter((item) => HEX_LITERAL.test(item.text) && !WHITE_TEXT.test(item.text));

    expect(offenders.map((item) => `tracker.css:${item.line}  ${item.text}`)).toEqual([]);
  });
});
