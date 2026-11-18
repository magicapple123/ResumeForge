// SPDX-License-Identifier: Apache-2.0
/**
 * 看板分段导航（T13）。
 *
 * 两件事值得钉：
 * 1. 点击后确实调用 `scrollIntoView`（且有对应 id 的段落存在）——jsdom 没有 IntersectionObserver，
 *    所以 effect 里必须能安全跳过，不能因此抛错；
 * 2. 当前段的高亮只落在 `aria-current` 上（样式见 modules-home.css），不是"再加一个 class"。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import AnalyticsNav, { ANALYTICS_SECTIONS } from "./AnalyticsNav";

beforeEach(() => {
  // 让每个段落 id 真实存在：导航的点击是按 id 找元素的。
  for (const section of ANALYTICS_SECTIONS) {
    const element = document.createElement("div");
    element.id = section.id;
    element.scrollIntoView = vi.fn();
    document.body.appendChild(element);
  }
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("AnalyticsNav（T13）", () => {
  it("列出全部段落，且当前段只有 aria-current", () => {
    render(<AnalyticsNav />);
    expect(screen.getAllByRole("button")).toHaveLength(ANALYTICS_SECTIONS.length);
    const current = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
  });

  it("点击后滚到对应段落，并把高亮交给它", () => {
    render(<AnalyticsNav />);
    fireEvent.click(screen.getByRole("button", { name: t("analyticsPage.nav.trend") }));
    const target = document.getElementById("analytics-trend");
    expect(target?.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(
      screen
        .getByRole("button", { name: t("analyticsPage.nav.trend") })
        .getAttribute("aria-current"),
    ).toBe("true");
  });
});
