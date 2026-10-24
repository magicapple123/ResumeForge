// SPDX-License-Identifier: Apache-2.0
/** 翻译候选（W16）：勾选采纳、事实锁禁用、四态与取消。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import { MOCK_CANDIDATES } from "../../../features/resume-bilingual/mock";
import TranslationCandidatePanel from "./TranslationCandidatePanel";

afterEach(() => cleanup());

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof TranslationCandidatePanel>> = {},
) {
  const onAdopt = vi.fn();
  const props: React.ComponentProps<typeof TranslationCandidatePanel> = {
    candidates: MOCK_CANDIDATES,
    onAdopt,
    ...overrides,
  };
  render(
    <AntdApp>
      <TranslationCandidatePanel {...props} />
    </AntdApp>,
  );
  return { onAdopt };
}

describe("TranslationCandidatePanel", () => {
  it("错误态优先于列表，并带重新生成", () => {
    const onRetry = vi.fn();
    renderPanel({ candidates: [], error: "llm down", onRetry });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.candidate.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("加载态用统一加载出口", () => {
    renderPanel({ candidates: [], loading: true });
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("没有候选时给说明", () => {
    renderPanel({ candidates: [] });
    expect(screen.getByText(bt("bilingual.candidate.empty"))).toBeTruthy();
  });

  it("全选只勾可选条目，采纳回调收到路径数组", () => {
    const { onAdopt } = renderPanel();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    const adopt = screen.getByRole("button", {
      name: bt("bilingual.candidate.adoptSelected", { count: 2 }),
    });
    fireEvent.click(adopt);
    expect(onAdopt).toHaveBeenCalledTimes(1);
    const paths = onAdopt.mock.calls[0][0] as string[];
    expect(paths).toHaveLength(2);
    expect(paths).not.toContain("experience.0.company");
  });

  it("事实锁候选的勾选框被禁用", () => {
    renderPanel();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[boxes.length - 1]).toBeDisabled();
    expect(screen.getByText(bt("bilingual.compare.locked"))).toBeTruthy();
  });

  it("取消只是回调，不改任何内容", () => {
    const onCancel = vi.fn();
    renderPanel({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.candidate.cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
