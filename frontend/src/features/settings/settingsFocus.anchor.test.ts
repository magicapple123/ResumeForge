// SPDX-License-Identifier: Apache-2.0
/**
 * #9：深链锚点（`/settings?tab=…#conn-search-beta`）的定位与高亮。
 *
 * 这里钉住三件在 jsdom 里**能**判定的事，布局留给 Playwright：
 *
 * 1. 目标在**隐藏分组**里时不许动：`display:none` 的元素没有布局盒，滚过去等于没滚；
 *    这类落空必须让调用方知道（返回 `false`），它才好去切分组；
 * 2. 命中即高亮（`settings-card-target`），2 秒后自动摘掉——否则用户下次进来会看到
 *    上一轮留下的边框；
 * 3. 非法/不存在的锚点静默失败：`#123` 这类会被 `querySelector` 当成 ID 选择器抛错，
 *    一次手抖的 URL 不该把整页炸白。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealSettingsAnchor } from "./settingsFocus";

/** 造一个分组容器；`hidden` 时加 `[hidden]` 属性（与 SettingsPage 的结构一致）。 */
function makeSection(hidden: boolean): HTMLElement {
  const section = document.createElement("div");
  section.className = "settings-section";
  if (hidden) section.hidden = true;
  document.body.appendChild(section);
  return section;
}

/** 行元素：`scrollIntoView` 在 jsdom 里不存在，补一个可断言的桩。 */
function makeRow(section: HTMLElement, anchor: string): HTMLElement {
  const row = document.createElement("div");
  row.id = anchor;
  row.className = "connection-row";
  row.scrollIntoView = vi.fn();
  section.appendChild(row);
  return row;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("revealSettingsAnchor", () => {
  it("命中可见行时滚动并高亮，2 秒后自动摘掉", () => {
    const section = makeSection(false);
    const row = makeRow(section, "conn-search-beta");

    expect(revealSettingsAnchor("#conn-search-beta")).toBe(true);
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(row).toHaveClass("settings-card-target");

    // 高亮是 2 秒的动画类：留在 DOM 里会让下一次进入看到一条假边框。
    vi.advanceTimersByTime(2000);
    expect(row).not.toHaveClass("settings-card-target");
  });

  it("目标在隐藏分组里时不滚也不高亮（切分组是调用方的事）", () => {
    const section = makeSection(true);
    const row = makeRow(section, "conn-llm-api-key");

    expect(revealSettingsAnchor("#conn-llm-api-key")).toBe(false);
    expect(row.scrollIntoView).not.toHaveBeenCalled();
    expect(row).not.toHaveClass("settings-card-target");
  });

  it("目标还没渲染出来（异步列表）时返回 false，交给调用方重试", () => {
    makeSection(false);
    expect(revealSettingsAnchor("#conn-search-beta")).toBe(false);
  });

  it("空锚点与非法选择器都静默失败", () => {
    makeSection(false);
    expect(revealSettingsAnchor("")).toBe(false);
    expect(revealSettingsAnchor("#")).toBe(false);
    // `#123abc` 是非法 ID 选择器：`querySelector` 会抛错，这里必须吞掉。
    expect(() => revealSettingsAnchor("#123abc")).not.toThrow();
    expect(revealSettingsAnchor("#123abc")).toBe(false);
  });
});
