// SPDX-License-Identifier: Apache-2.0
/** W03：历史页签（只画不持有；点步骤只预览，回退走撤销按钮）。 */
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

const STEPS: HistoryPanelStep[] = [
  { label: t("workbench.history.label.text"), summary: "Alex · 0 条 · 1 页" },
  { label: t("workbench.history.label.layout"), summary: "Alex · 0 条 · 2 页" },
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
  render(
    <AntdApp>
      <HistoryPanel
        past={STEPS}
        future={[]}
        canUndo
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onUndo, onRedo };
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
});
