// SPDX-License-Identifier: Apache-2.0
/**
 * W03：历史页签（只画不持有；点步骤只预览，回退要再点「回到这一步」并确认）。
 *
 * 2026-10-29：每步右侧显示时间；预览条给「回到这一步 / 回到当前」；撤销/恢复带图标等宽。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import HistoryPanel, { type HistoryPanelStep } from "./HistoryPanel";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** 两步都用"刚才"的时间：`formatStepTime` 对今天输出 HH:mm，断言才稳定。 */
const NOW = Date.now();

const STEPS: HistoryPanelStep[] = [
  { label: t("workbench.history.label.text"), summary: "Alex · 0 条 · 1 页", at: NOW - 60_000 },
  { label: t("workbench.history.label.layout"), summary: "Alex · 0 条 · 2 页", at: NOW },
];

/** antd 会在两个汉字的按钮文案里插空格（"撤 销"）：按归一化 textContent 找按钮。 */
function buttonByText(label: string): HTMLElement {
  const normalized = label.replace(/\s+/g, "");
  const button = [...document.querySelectorAll<HTMLElement>("button")].find(
    (node) => (node.textContent ?? "").replace(/\s+/g, "") === normalized,
  );
  if (!button) throw new Error(`没有找到按钮：${label}`);
  return button;
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof HistoryPanel>> = {}) {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onJumpTo = vi.fn();
  render(
    <AntdApp>
      <HistoryPanel
        past={STEPS}
        future={[]}
        canUndo
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
        onJumpTo={onJumpTo}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onUndo, onRedo, onJumpTo };
}

describe("HistoryPanel", () => {
  it("没有历史时给空态，撤销/恢复都禁用", () => {
    renderPanel({ past: [], future: [], canUndo: false, canRedo: false });
    expect(screen.getByText(t("workbench.history.empty"))).toBeInTheDocument();
    expect(buttonByText(t("workbench.history.undo"))).toBeDisabled();
    expect(buttonByText(t("workbench.history.redo"))).toBeDisabled();
  });

  it("步骤按最新在上展示，点一步只显示摘要预览（不改文档）", () => {
    const { onUndo } = renderPanel();
    const newest = screen.getByRole("button", {
      name: new RegExp(t("workbench.history.label.layout")),
    });
    fireEvent.click(newest);
    const preview = screen.getByRole("status");
    expect(preview).toHaveTextContent(t("workbench.history.preview.label"));
    expect(preview).toHaveTextContent(t("workbench.history.label.layout"));
    expect(preview).toHaveTextContent("Alex · 0 条 · 2 页");
    // 预览条必须在列表之前（DOM 顺序）：放在底部会与刚点的那一行逐字重复，
    // 视觉上像"列表里多出一行"，也丢掉了"这是预览"的语义。
    expect(preview.compareDocumentPosition(newest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 点步骤不触发回退。
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("撤销/恢复按钮接到宿主回调", () => {
    const { onUndo, onRedo } = renderPanel({ future: [STEPS[0]], canRedo: true });
    fireEvent.click(buttonByText(t("workbench.history.undo")));
    fireEvent.click(buttonByText(t("workbench.history.redo")));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("workbench.history.future"))).toBeInTheDocument();
  });

  it("每一步右侧显示时间（今天只给 HH:mm）", () => {
    renderPanel();
    const times = [...document.querySelectorAll<HTMLElement>(".resume-history-step-time")].map(
      (node) => node.textContent ?? "",
    );
    expect(times).toHaveLength(STEPS.length);
    for (const time of times) expect(time).toMatch(/^\d{2}:\d{2}$/);
    // 最新一步（倒序第一条）时间是 NOW 那个，比上一条晚：同一分钟内允许相等，只校形状。
    expect(times[0]).not.toBe("");
  });

  it("「回到当前」取消选中：预览条消失、不触发回退", () => {
    const { onJumpTo } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("workbench.history.label.layout")) }),
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(buttonByText(t("workbench.history.backToCurrent")));
    expect(screen.queryByRole("status")).toBeNull();
    expect(onJumpTo).not.toHaveBeenCalled();
  });

  it("「回到这一步」要二次确认，确认后才让宿主回退到该下标", () => {
    const { onJumpTo } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("workbench.history.label.text")) }),
    );
    fireEvent.click(buttonByText(t("workbench.history.jumpTo")));
    // 确认前不动文档。
    expect(onJumpTo).not.toHaveBeenCalled();
    const confirm = document.querySelector<HTMLElement>(".ant-popconfirm .ant-btn-primary");
    if (!confirm) throw new Error("popconfirm 确认按钮缺失");
    fireEvent.click(confirm);
    // 最旧那一步的数据下标是 0（界面倒序展示，下标换算由面板负责）。
    expect(onJumpTo).toHaveBeenCalledWith("past", 0);
  });
});
