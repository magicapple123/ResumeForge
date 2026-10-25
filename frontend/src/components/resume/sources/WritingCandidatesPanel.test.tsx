// SPDX-License-Identifier: Apache-2.0
/** W12 局部写作候选面板：缺 path 禁用 + 提示；候选/采纳/冲突文案。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import type { WritingCandidateState } from "../../../features/resume-provenance/types";
import WritingCandidatesPanel from "./WritingCandidatesPanel";

function states(): WritingCandidateState[] {
  return [
    { mode: "concise", status: "idle", suggestion: null, errorMessage: "" },
    { mode: "method", status: "idle", suggestion: null, errorMessage: "" },
    { mode: "result", status: "idle", suggestion: null, errorMessage: "" },
  ];
}

afterEach(() => {
  cleanup();
});

function renderPanel(overrides: Partial<React.ComponentProps<typeof WritingCandidatesPanel>> = {}) {
  const onGenerate = vi.fn();
  render(
    <AntdApp>
      <WritingCandidatesPanel
        states={states()}
        onGenerate={onGenerate}
        onDiscard={vi.fn()}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onGenerate };
}

describe("WritingCandidatesPanel", () => {
  it("缺可改写 path 时禁用生成并给出原因（不静默无反应）", () => {
    const { onGenerate } = renderPanel({ disabledReason: pt("provenance.candidate.needPoint") });
    expect(screen.getByText(pt("provenance.candidate.generateDisabled"))).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: pt("provenance.candidate.generate") });
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(buttons[0]);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("有建议时展示原文/建议并可采纳", () => {
    const onAdopt = vi.fn();
    const ready: WritingCandidateState = {
      mode: "concise",
      status: "ready",
      errorMessage: "",
      suggestion: {
        path: "experience.0.description.0",
        label: "工作内容",
        context: "",
        original: "Original sentence.",
        result: "Shorter sentence.",
        kind: "text",
        lines: [],
      },
    };
    renderPanel({ states: [ready, ...states().slice(1)], onAdopt });
    expect(screen.getByText("Original sentence.")).toBeTruthy();
    expect(screen.getByText("Shorter sentence.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.candidate.adopt") }));
    expect(onAdopt).toHaveBeenCalledWith(ready);
  });

  it("事实锁/版本冲突的 409 业务码给专门说明", () => {
    renderPanel({ conflictCode: "fact_lock_conflict" });
    expect(screen.getByText(pt("provenance.lock.conflict"))).toBeTruthy();
  });
});
