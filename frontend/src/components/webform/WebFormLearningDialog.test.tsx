/**
 * 「要记住吗」的弹窗。
 *
 * 这个组件是**这个功能的安全阀**：学到的值下次会自动填，所以"看得见、能取消、能改档位"
 * 不是锦上添花。下面几条钉的都是这个：
 *
 * - 默认全勾、默认「通用」（用户选的默认行为，快感优先）；
 * - **AI 认的要单独标出来**（它比规则更可能认错字段）；
 * - 取消勾选/选「本次」要真的传到提交结果里，否则用户以为改了其实没改。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebFormLearningDialog from "./WebFormLearningDialog";
import type { WebFormLearningCandidate } from "../../types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const CANDIDATES: WebFormLearningCandidate[] = [
  { key: "height", label: "身高(cm)", value: "178", from: "rule" },
  { key: "recruit_source", label: "招聘信息来源", value: "BOSS直聘", from: "ai" },
];

/**
 * 表格的**数据行**。
 *
 * ⚠️ antd 的 tbody 里除了数据行还有一个 ``ant-table-measure-row``（算滚动宽度用的），
 * 它**也带一个 checkbox input**——所以按「第几个复选框」取会整体错位一格。
 * 用行类名 ``ant-table-row-level-0`` 取数据行，表头的全选也不在其中。
 */
function dataRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ant-table-tbody tr.ant-table-row-level-0"),
  );
}

/** 第 `rowIndex` 条数据行的行选择框。 */
function rowCheckbox(rowIndex: number): HTMLElement {
  const box = dataRows()[rowIndex].querySelector<HTMLElement>("input[type=checkbox]");
  if (!box) throw new Error(`第 ${rowIndex} 行没有选择框`);
  return box;
}

/** 第 `rowIndex` 条数据行里文案为 `label` 的档位标签。同文案会出现多份，所以按行取。 */
function tagInRow(rowIndex: number, label: string): Element | undefined {
  return Array.from(dataRows()[rowIndex].querySelectorAll(".ant-tag")).find(
    (tag) => tag.textContent?.trim() === label,
  );
}

function renderDialog(candidates: WebFormLearningCandidate[] = CANDIDATES, onSubmit = vi.fn()) {
  render(
    <AntdApp>
      <WebFormLearningDialog
        open
        candidates={candidates}
        saving={false}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />
    </AntdApp>,
  );
  return onSubmit;
}

describe("WebFormLearningDialog", () => {
  it("把候选逐条列出来，标题写着有几项", () => {
    renderDialog();

    expect(screen.getByText(/本次填的 2 项简历通里没有/)).toBeInTheDocument();
    expect(screen.getByText("身高(cm)")).toBeInTheDocument();
    expect(screen.getByText("178")).toBeInTheDocument();
    expect(screen.getByText("招聘信息来源")).toBeInTheDocument();
  });

  it("AI 认出来的单独打标——它比规则更可能认错字段", () => {
    renderDialog();

    // 恰好一条标了「AI 认的」，且它属于那条 ai 来源的候选。
    expect(screen.getAllByText("AI 认的")).toHaveLength(1);
  });

  it("默认全勾、默认「通用」——这是用户选定的默认行为", async () => {
    const onSubmit = renderDialog();

    // 全勾：两个都选中 → 按钮文案是 2。
    expect(screen.getByRole("button", { name: /记住选中的 2 项/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /记住选中的 2 项/ }));

    expect(onSubmit).toHaveBeenCalledWith([
      { candidate: CANDIDATES[0], reuse: "general" },
      { candidate: CANDIDATES[1], reuse: "general" },
    ]);
  });

  it("取消勾选的那条不会进提交结果", async () => {
    const onSubmit = renderDialog();

    expect(dataRows()).toHaveLength(2);
    fireEvent.click(rowCheckbox(0));

    fireEvent.click(screen.getByRole("button", { name: /记住选中的 1 项/ }));

    expect(onSubmit).toHaveBeenCalledWith([{ candidate: CANDIDATES[1], reuse: "general" }]);
  });

  it("改成「本次」后，档位跟着提交——否则用户以为改了其实没改", async () => {
    const onSubmit = renderDialog();

    // 三档标签在每行的「下次」列里，同文案会出现多份，所以按行取。
    const onceTag = tagInRow(0, "本次");
    expect(onceTag).toBeTruthy();
    fireEvent.click(onceTag as Element);

    fireEvent.click(screen.getByRole("button", { name: /记住选中的 2 项/ }));

    expect(onSubmit).toHaveBeenCalledWith([
      { candidate: CANDIDATES[0], reuse: "once" },
      { candidate: CANDIDATES[1], reuse: "general" },
    ]);
  });

  it("一条都不勾时确认按钮禁用——不能提交一个空的选择", () => {
    renderDialog();

    fireEvent.click(rowCheckbox(0));
    fireEvent.click(rowCheckbox(1));

    expect(screen.getByRole("button", { name: /记住选中的 0 项/ })).toBeDisabled();
  });
});
