// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位表单（抽屉内的视图）：招聘原文（粘贴点，导入时预填 JD）的长度治理。
 *
 * 硬上限走 maxLength（与后端备选岗位 raw_text 的 max_length=50_000 对齐），
 * 顶到上限才出现一行提示——全仓禁用 antd showCount 常驻计数。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { CandidateJobFormView } from "./CandidateJobFormView";
import { EMPTY_FORM } from "./candidateShared";

function renderModal(formState = EMPTY_FORM) {
  return render(
    <CandidateJobFormView
      submitting={false}
      formState={formState}
      onChange={vi.fn()}
      onAddImages={vi.fn()}
      onRejected={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("CandidateJobFormView", () => {
  it("招聘原文有 50000 字硬上限；顶到上限时出现提示（不使用 showCount 计数器）", () => {
    renderModal({ ...EMPTY_FORM, rawText: "好".repeat(50000) });

    const raw = screen.getByPlaceholderText(
      t("jobs.candidate.form.raw-placeholder"),
    ) as HTMLTextAreaElement;
    expect(raw.maxLength).toBe(50000);
    expect(screen.getByText(/50000/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*\/\s*50000/)).not.toBeInTheDocument();
  });

  it("未达上限时不出现长度提示", () => {
    renderModal({ ...EMPTY_FORM, rawText: "plenty of room" });

    expect(screen.queryByText(/50000/)).not.toBeInTheDocument();
  });
});
