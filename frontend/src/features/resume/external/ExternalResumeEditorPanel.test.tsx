// SPDX-License-Identifier: Apache-2.0
/**
 * 右侧表单的三条口径：没改就不给点、不可编辑的块说清原因、溢出时**默认不动**。
 *
 * 溢出那条是本文件的主守卫：红框里必须有「下移下方内容 Δpt」按钮，而且只有点了才回调
 * `onShiftBelow`（反证：把 overflow 分支删掉，第三条用例精确变红）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeBlock } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { ExternalResumeEditorPanel } from "./ExternalResumeEditorPanel";

const BLOCK: ExternalResumeBlock = {
  block_id: "p1b0",
  page: 1,
  text: "旧标题",
  editable: true,
  reason: "",
  x0: 60,
  y0: 700,
  x1: 360,
  y1: 720,
  size: 18,
  leading: 22,
  align: "left",
};

function renderPanel(over: Partial<ComponentProps<typeof ExternalResumeEditorPanel>> = {}) {
  const props = {
    block: BLOCK,
    blockLabel: "第 1 页 · 第 1 段",
    submitting: false,
    outcome: null,
    error: "",
    onApply: vi.fn(),
    onShiftBelow: vi.fn(),
    ...over,
  };
  render(<ExternalResumeEditorPanel {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("ExternalResumeEditorPanel", () => {
  it("还没选块时只提示先选一段", () => {
    renderPanel({ block: null });
    expect(screen.getByTestId("external-panel-empty")).toHaveTextContent(t("externalEdit.hint.pick"));
    expect(screen.queryByTestId("external-apply")).toBeNull();
  });

  it("文字没变时「应用」不可点，改了之后带上新文字回调", () => {
    const props = renderPanel();
    const apply = screen.getByTestId("external-apply");
    expect(apply).toBeDisabled();

    fireEvent.change(screen.getByTestId("external-text-input"), { target: { value: "新标题" } });
    expect(screen.getByTestId("external-apply")).toBeEnabled();
    fireEvent.click(screen.getByTestId("external-apply"));
    expect(props.onApply).toHaveBeenCalledWith("新标题");
  });

  it("不可编辑的块：写出原因，且不提供「应用」", () => {
    renderPanel({ block: { ...BLOCK, editable: false, reason: "pdf_block_rotated" } });
    expect(screen.getByTestId("external-panel-blocked")).toHaveTextContent(
      t("externalEdit.reason.pdf_block_rotated"),
    );
    expect(screen.queryByTestId("external-apply")).toBeNull();
    expect(screen.queryByTestId("external-text-input")).toBeNull();
  });

  it("溢出：红框 + 「下移下方内容 Δpt」按钮，点它才回调（位移取上整）", () => {
    const props = renderPanel({
      outcome: { deltaPt: 23.4, overflow: true, scaled: false, shifted: false, linesBefore: 2, linesAfter: 3 },
    });

    const alert = screen.getByTestId("external-overflow");
    expect(alert).toHaveTextContent(t("externalEdit.overflow.title"));
    // 默认什么都不动：没有点按钮之前，不会有任何回调。
    expect(props.onShiftBelow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("external-shift"));
    expect(props.onShiftBelow).toHaveBeenCalledWith(24);
  });

  it("缩过字号 / 已下移各给一条提示", () => {
    renderPanel({
      outcome: { deltaPt: 0, overflow: false, scaled: true, shifted: true, linesBefore: 1, linesAfter: 1 },
    });
    expect(screen.getByTestId("external-scaled")).toHaveTextContent(t("externalEdit.scaled"));
    expect(screen.getByTestId("external-shifted")).toHaveTextContent(t("externalEdit.shifted"));
    expect(screen.queryByTestId("external-overflow")).toBeNull();
  });

  it("应用失败：把后端的原因原样显示出来", () => {
    renderPanel({ error: "新文字里有系统字体渲染不出的字，请换掉这些字" });
    expect(screen.getByTestId("external-apply-error")).toHaveTextContent(
      "新文字里有系统字体渲染不出的字，请换掉这些字",
    );
  });
});
