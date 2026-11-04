// SPDX-License-Identifier: Apache-2.0
/** 改进建议卡片：三档优先级必须显示本地化文案，不能把 high/medium/low 原文打出来。 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { selectLocale } from "../../i18n/localeStore";
import type { ResumeSuggestion } from "../../types";
import SuggestionsCard from "./SuggestionsCard";

function suggestion(priority: ResumeSuggestion["priority"], issue: string): ResumeSuggestion {
  return { priority, section: "经历", issue, suggestion: "补一句量化结果", evidence: [] };
}

const SUGGESTIONS: ResumeSuggestion[] = [
  suggestion("high", "缺少量化结果"),
  suggestion("medium", "分区顺序不合理"),
  suggestion("low", "多余形容词"),
];

beforeEach(() => {
  selectLocale("zh-CN");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  selectLocale("zh-CN");
});

describe("SuggestionsCard 优先级标签", () => {
  it("中文界面显示高 / 中 / 低", () => {
    render(<SuggestionsCard suggestions={SUGGESTIONS} />);

    expect(screen.getByText(t("interview.suggestions.priority.high"))).toBeInTheDocument();
    expect(screen.getByText(t("interview.suggestions.priority.medium"))).toBeInTheDocument();
    expect(screen.getByText(t("interview.suggestions.priority.low"))).toBeInTheDocument();
  });

  it("页面上不出现 high / medium / low 原文", () => {
    const { container } = render(<SuggestionsCard suggestions={SUGGESTIONS} />);

    for (const level of ["high", "medium", "low"]) {
      expect(screen.queryByText(new RegExp(`^${level}$`, "i"))).toBeNull();
    }
    // 标签文本来自词表，不是 item.priority 直接打印。
    expect(container.textContent).not.toMatch(/\bhigh\b/i);
    expect(container.textContent).not.toMatch(/\bmedium\b/i);
    expect(container.textContent).not.toMatch(/\blow\b/i);
  });

  it("切到 en-US 显示 High / Medium / Low", () => {
    render(<SuggestionsCard suggestions={SUGGESTIONS} />);

    act(() => selectLocale("en-US"));

    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });
});
