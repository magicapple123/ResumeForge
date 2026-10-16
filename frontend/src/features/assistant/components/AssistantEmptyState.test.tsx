/**
 * 助手空态：深夜关怀语的对比度回归。
 *
 * 该文案此前用 antd `Typography` 的 `type="warning"`（colorWarning #faad14），在白/浅底上
 * 对比度只有 ~1.9:1，过不了 axe color-contrast 的 AA（4.5:1）。现改用站内 warning 文字
 * token。这里渲染真实组件，确认走的是新的语义类（而不是 antd 的 warning 类）；再直接量
 * token 色对白底与应用浅底的对比度，防止任何人把它改回不合格的值或写法。
 *
 * 说明：jsdom 不解析 CSS `var()`（`color: var(--x)` 会被整条丢弃），所以颜色对比度从样式表
 * 源码取值来量，而不是读 getComputedStyle。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssistantEmptyState from "./AssistantEmptyState";
import tokenStyles from "../../../theme/design-tokens.css?inline";
import accessibilityStyles from "../../../styles/accessibility.css?inline";

const CARE_TEXT = "夜已经深了，改完这一份就早点休息吧";
const WARNING_TOKEN = "--rf-warning-text";

function renderEmptyState() {
  return render(
    <AssistantEmptyState
      variant="page"
      onChoosePrompt={() => undefined}
      enabledSkillCount={1}
      skillsLoaded
      onManageSkills={() => undefined}
    />,
  );
}

/** 从样式表源码里取某个类选择器规则的颜色声明（可能是 var() 引用）。 */
function declaredColor(selector: string) {
  const escaped = selector.replace(/\./g, "\\.");
  const block = accessibilityStyles.match(new RegExp(`${escaped}[^{]*\\{([^}]*)\\}`));
  const color = block?.[1].match(/color:\s*([^;]+);/);
  return color ? color[1].trim() : "";
}

/** 取 :root 里某个 token 的十六进制值。 */
function tokenHex(name: string) {
  const match = tokenStyles.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, "i"));
  return match ? match[1] : "";
}

/** WCAG 相对亮度（输入 #rrggbb）。 */
function luminance(hexColor: string) {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hexColor.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AssistantEmptyState 深夜关怀语", () => {
  it("深夜渲染关怀语，且用站内 token 类而非 antd 的 type=warning", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(23);

    renderEmptyState();

    const care = screen.getByText(CARE_TEXT);
    expect(care.className).toContain("assistant-empty-state-care");
    // 回归：不再命中 antd 的 warning 类（其 #faad14 白底 ~1.9:1 不达标）。
    expect(care.className).not.toContain("ant-typography-warning");
  });

  it("白天不渲染关怀语", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(12);

    renderEmptyState();

    expect(screen.queryByText(CARE_TEXT)).toBeNull();
  });

  it("关怀语颜色取自 warning 文字 token，且白底/浅底都满足 4.5:1", () => {
    // 卡片样式把该文案降级到语义 token，而不是硬编码一个可能不合格的颜色。
    expect(declaredColor(".assistant-empty-state-care")).toBe(`var(${WARNING_TOKEN})`);

    const color = tokenHex(WARNING_TOKEN);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color, "#f6f8fb")).toBeGreaterThanOrEqual(4.5);
  });
});
