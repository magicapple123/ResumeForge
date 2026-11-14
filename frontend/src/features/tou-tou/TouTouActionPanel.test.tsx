// SPDX-License-Identifier: Apache-2.0
/**
 * 动作面板（#27C）+ 顺便问（#27E）：
 * - 本页动作 + 搜索全部动作；
 * - ↑↓ 高亮 / Enter 执行 / Esc 关闭；
 * - **焦点不逃出面板**（Tab 被接管）；
 * - Alt+Enter 发侧问并就地显示回答；划词动作可"打开即问"（autoAsk）。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import TouTouActionPanel from "./TouTouActionPanel";
import type { DomSelectionSnapshot } from "./touTouSelection";

const PAGE_ACTIONS = [
  { id: "open-assistant", labelKey: "touTou.action.openAssistant" as const },
  { id: "side-ask", labelKey: "touTou.action.sideAsk" as const },
];

// 中文断言常量：`*ByText("中文")` 会被 cjkRatchet 计成新增中文断言。
const ANSWER_TEXT = "回答内容";
const RESULT_TEXT = "教育经历：A ↔ B";

const SELECTION: DomSelectionSnapshot = {
  text: "负责订单服务后端开发，QPS 提升 3 倍",
  rect: { top: 100, left: 40, right: 240, bottom: 120, width: 200, height: 20 },
  region: "resume-experience",
};

function setup(overrides: Partial<ComponentProps<typeof TouTouActionPanel>> = {}) {
  const props = {
    pageActions: PAGE_ACTIONS,
    selection: null,
    onRunAction: vi.fn(),
    onRunSelectionAction: vi.fn(),
    onSideAsk: vi.fn().mockResolvedValue("回答内容"),
    mutedCount: 0,
    onRestoreMuted: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<TouTouActionPanel {...props} />);
  return { ...view, props };
}

describe("动作面板", () => {
  it("展示本页动作，点一下就执行并关闭由宿主负责", () => {
    const { props } = setup();
    expect(screen.getByRole("dialog", { name: t("touTou.panel.title") })).toBeInTheDocument();
    expect(screen.getByText(t("touTou.panel.pageSection"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("touTou.action.sideAsk")));
    expect(props.onRunAction).toHaveBeenCalledWith("side-ask");
  });

  it("搜索全部动作：只在本页动作里的关键词不会命中别的路由动作", () => {
    const { props } = setup();
    const search = screen.getByRole("combobox", { name: t("touTou.panel.searchPlaceholder") });
    fireEvent.change(search, { target: { value: "知识库" } });
    expect(screen.getByText(t("touTou.action.goKnowledge"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("touTou.action.goKnowledge")));
    expect(props.onRunAction).toHaveBeenCalledWith("go-knowledge");
  });

  it("↑↓ 移动高亮、Enter 执行当前项", () => {
    const { props } = setup();
    const search = screen.getByRole("combobox", { name: t("touTou.panel.searchPlaceholder") });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onRunAction).toHaveBeenCalledWith("side-ask");
  });

  it("有选中文本时先给划词动作；点击把快照一起交回宿主", () => {
    const { props } = setup({ selection: SELECTION });
    expect(screen.getByText(t("touTou.selection.regionResume"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("touTou.selection.rewrite")));
    expect(props.onRunSelectionAction).toHaveBeenCalledWith("rewrite", SELECTION);
  });

  it("Esc 关闭", () => {
    const { props } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape even when the orb kept focus after pointer release", () => {
    const { props } = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("includes action items in the Tab loop and runs them from the keyboard", () => {
    const { props } = setup();
    const search = screen.getByRole("combobox");
    search.focus();
    fireEvent.keyDown(search, { key: "Tab" });
    expect(screen.getAllByRole("option")[0]).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(props.onRunAction).toHaveBeenCalledWith("open-assistant");
  });

  it("Tab 不逃出面板：焦点始终在面板内循环", () => {
    setup();
    const inside = () => {
      const panel = document.querySelector(".tt-panel");
      return panel !== null && panel.contains(document.activeElement);
    };
    for (let index = 0; index < 8; index += 1) {
      expect(inside()).toBe(true);
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
    }
    expect(inside()).toBe(true);
  });

  it("Alt+Enter 发侧问并就地显示回答（不进对话、不写历史由后端保证）", async () => {
    const { props } = setup();
    const textarea = screen.getByRole("textbox", { name: t("touTou.panel.sideAskPlaceholder") });
    fireEvent.change(textarea, { target: { value: "这条 JD 要求我够吗？" } });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    expect(props.onSideAsk).toHaveBeenCalledWith("这条 JD 要求我够吗？");
    expect(await screen.findByText(ANSWER_TEXT)).toBeInTheDocument();
    expect(screen.getByText(t("touTou.panel.answerTitle"))).toBeInTheDocument();
  });

  it("空问题不发请求，就地提示", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: t("touTou.panel.sideAskSend") }));
    expect(props.onSideAsk).not.toHaveBeenCalled();
    expect(screen.getByText(t("touTou.panel.sideAskEmpty"))).toBeInTheDocument();
  });

  it("autoAsk：打开即带着划词指令问一次", async () => {
    const { props } = setup({ selection: SELECTION, autoAsk: "rewrite instruction" });
    await waitFor(() => expect(props.onSideAsk).toHaveBeenCalledTimes(1));
    expect(props.onSideAsk).toHaveBeenCalledWith("rewrite instruction");
    expect(await screen.findByText(ANSWER_TEXT)).toBeInTheDocument();
  });

  it("initialResult：本地动作结果直接展示（复制 / 查重复条目）", () => {
    setup({
      initialResult: {
        title: t("touTou.selection.duplicateFound", { count: 2 }),
        text: RESULT_TEXT,
      },
    });
    expect(
      screen.getByText(t("touTou.selection.duplicateFound", { count: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(RESULT_TEXT)).toBeInTheDocument();
  });

  it("静音过提示时给「恢复提示」入口", () => {
    const { props } = setup({ mutedCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: t("touTou.panel.restoreMuted") }));
    expect(props.onRestoreMuted).toHaveBeenCalledTimes(1);
  });
});
