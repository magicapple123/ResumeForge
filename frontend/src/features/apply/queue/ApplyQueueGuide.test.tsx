// SPDX-License-Identifier: Apache-2.0
/**
 * CR-17：队列四步说明「不再自动展开」。
 *
 * 旧行为是「第一次进来自动展开一次」，靠 `localStorage` 记住已经看过；代价是首屏
 * 多出一层浮层，用户点进来先看到的是说明而不是队列。新口径与原型一致：说明只由
 * 用户点「?」触发，渲染过程不读写任何存储键。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ApplyQueueGuide } from "./ApplyQueueGuide";

const STORAGE_KEY = "resumeforge.apply.guide_seen";

function renderGuide() {
  return render(
    <AntdApp>
      <ApplyQueueGuide />
    </AntdApp>,
  );
}

describe("ApplyQueueGuide（CR-17）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("初次渲染不展开说明", () => {
    renderGuide();

    expect(screen.queryByText(t("applyQueue.guide.title"))).not.toBeInTheDocument();
  });

  it("点「?」才展开四步说明", async () => {
    renderGuide();

    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.guide.triggerAria") }));

    expect(await screen.findByText(t("applyQueue.guide.title"))).toBeInTheDocument();
  });

  it("渲染与展开都不写 localStorage", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");

    renderGuide();
    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.guide.triggerAria") }));
    await screen.findByText(t("applyQueue.guide.title"));

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
