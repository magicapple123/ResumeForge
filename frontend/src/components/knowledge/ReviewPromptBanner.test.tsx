// SPDX-License-Identifier: Apache-2.0
/** 复习提醒条（#29F）：每周最多提示一次，localStorage 按自然周去重，失败安静。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ReviewPromptBanner from "./ReviewPromptBanner";
import { currentWeekStart, REVIEW_PROMPT_STORAGE_KEY } from "./reviewWeek";

const getKnowledgeReviewPrompt = vi.fn();
vi.mock("../../api/knowledge", () => ({
  getKnowledgeReviewPrompt: (...args: unknown[]) => getKnowledgeReviewPrompt(...args),
}));

const STORAGE_KEY = REVIEW_PROMPT_STORAGE_KEY;

const PROMPT = {
  count: 2,
  items: [
    {
      id: 1,
      title: "限流笔记",
      category: "面经",
      tags: [],
      source: "",
      content_excerpt: "",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
    {
      id: 2,
      title: "STAR 模板",
      category: "",
      tags: [],
      source: "",
      content_excerpt: "",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  ],
};

function renderBanner() {
  return render(
    <AntdApp>
      <ReviewPromptBanner />
    </AntdApp>,
  );
}

beforeEach(() => {
  getKnowledgeReviewPrompt.mockReset();
  getKnowledgeReviewPrompt.mockResolvedValue(PROMPT);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ReviewPromptBanner", () => {
  it("有候选时显示条数与条目名", async () => {
    renderBanner();
    expect(
      await screen.findByText(t("knowledgePage.review.title", { count: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(PROMPT.items[0].title)).toBeInTheDocument();
    expect(getKnowledgeReviewPrompt).toHaveBeenCalledWith({ stale_days: 30, limit: 5 });
  });

  it("本周不再提示：写入本周键并隐藏，再进入页面不再请求", async () => {
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: t("knowledgePage.review.dismiss") }));
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBe(currentWeekStart()));
    expect(
      screen.queryByText(t("knowledgePage.review.title", { count: 2 })),
    ).not.toBeInTheDocument();
    cleanup();
    getKnowledgeReviewPrompt.mockClear();
    renderBanner();
    await waitFor(() => expect(getKnowledgeReviewPrompt).not.toHaveBeenCalled());
  });

  it("没有候选 / 接口失败时安静不渲染", async () => {
    getKnowledgeReviewPrompt.mockResolvedValue({ count: 0, items: [] });
    const first = renderBanner();
    await waitFor(() => expect(getKnowledgeReviewPrompt).toHaveBeenCalled());
    expect(
      screen.queryByText(t("knowledgePage.review.title", { count: 2 })),
    ).not.toBeInTheDocument();
    first.unmount();
    getKnowledgeReviewPrompt.mockRejectedValue(new Error("network"));
    renderBanner();
    await waitFor(() => expect(getKnowledgeReviewPrompt).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
