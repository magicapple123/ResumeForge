/**
 * 备选岗位表单弹窗：招聘原文（粘贴点，导入时预填 JD）的长度治理。
 *
 * 硬上限走 maxLength（与后端备选岗位 raw_text 的 max_length=50_000 对齐），
 * 顶到上限才出现一行提示——全仓禁用 antd showCount 常驻计数。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateJobFormModal } from "./CandidateJobFormModal";
import { EMPTY_FORM } from "./candidateShared";

function renderModal(formState = EMPTY_FORM) {
  return render(
    <CandidateJobFormModal
      open
      editing={null}
      submitting={false}
      formState={formState}
      onChange={vi.fn()}
      onAddImages={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      onRejected={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("CandidateJobFormModal", () => {
  it("招聘原文有 50000 字硬上限；顶到上限时出现提示（不使用 showCount 计数器）", () => {
    renderModal({ ...EMPTY_FORM, rawText: "好".repeat(50000) });

    const raw = screen.getByPlaceholderText(/把招聘信息原样粘贴进来/) as HTMLTextAreaElement;
    expect(raw.maxLength).toBe(50000);
    expect(screen.getByText("已达 50000 字上限")).toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*\/\s*50000/)).not.toBeInTheDocument();
  });

  it("未达上限时不出现长度提示", () => {
    renderModal({ ...EMPTY_FORM, rawText: "一段正常的招聘信息" });

    expect(screen.queryByText(/已达/)).not.toBeInTheDocument();
  });
});
