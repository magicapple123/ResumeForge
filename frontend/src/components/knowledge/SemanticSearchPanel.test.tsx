// SPDX-License-Identifier: Apache-2.0
/** 语义检索面板（#29A）：命中、回退提示、空态/错误重试、点击打开。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { KnowledgeSearchOut } from "../../types";
import SemanticSearchPanel from "./SemanticSearchPanel";

const searchKnowledge = vi.fn();
vi.mock("../../api/knowledge", () => ({
  searchKnowledge: (...args: unknown[]) => searchKnowledge(...args),
}));

const HIT = {
  id: 7,
  title: "限流设计笔记",
  snippet: "令牌桶允许突发，漏桶平滑输出",
  score: 0.82,
  matched_heading: "系统设计",
  used_vector: true,
};

function renderPanel(onOpen = vi.fn(), company = "") {
  return render(
    <AntdApp>
      <SemanticSearchPanel query="限流" company={company} onOpen={onOpen} />
    </AntdApp>,
  );
}

const RESULT: KnowledgeSearchOut = {
  items: [HIT],
  keyword_count: 1,
  vector_count: 1,
  fallback_reason: "",
};

beforeEach(() => {
  searchKnowledge.mockReset();
  searchKnowledge.mockResolvedValue(RESULT);
});

afterEach(() => {
  cleanup();
});

describe("SemanticSearchPanel", () => {
  it("渲染命中：标题、摘要、向量标记与相关度；点击回传 id", async () => {
    const onOpen = vi.fn();
    renderPanel(onOpen);
    expect(await screen.findByText(HIT.title)).toBeInTheDocument();
    expect(screen.getByText(HIT.snippet)).toBeInTheDocument();
    expect(screen.getByText(t("knowledgePage.semantic.vectorTag"))).toBeInTheDocument();
    expect(
      screen.getByText(t("knowledgePage.semantic.score", { score: "0.82" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(HIT.title) }));
    expect(onOpen).toHaveBeenCalledWith(7);
    expect(searchKnowledge).toHaveBeenCalledWith({ q: "限流", company: undefined, limit: 20 });
  });

  it("向量路不可用：如实显示回退关键词的提示", async () => {
    searchKnowledge.mockResolvedValue({
      ...RESULT,
      fallback_reason: "embedding runtime missing",
    });
    renderPanel();
    expect(
      await screen.findByText(
        t("knowledgePage.semantic.fallback", { reason: "embedding runtime missing" }),
      ),
    ).toBeInTheDocument();
  });

  it("没有命中时显示空态", async () => {
    searchKnowledge.mockResolvedValue({ ...RESULT, items: [] });
    renderPanel();
    expect(await screen.findByText(t("knowledgePage.semantic.empty"))).toBeInTheDocument();
  });

  it("检索失败显示错误并可重试（第二次成功）", async () => {
    searchKnowledge.mockRejectedValueOnce(new Error("检索服务不可用"));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("检索服务不可用");
    searchKnowledge.mockResolvedValueOnce(RESULT);
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    expect(await screen.findByText(HIT.title)).toBeInTheDocument();
    expect(searchKnowledge).toHaveBeenCalledTimes(2);
  });

  it("company 透传给检索接口（面试页带公司进来）", async () => {
    renderPanel(vi.fn(), "字节跳动");
    await waitFor(() => expect(searchKnowledge).toHaveBeenCalled());
    expect(searchKnowledge.mock.calls[0][0].company).toBe("字节跳动");
  });
});
