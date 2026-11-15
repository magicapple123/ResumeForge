// SPDX-License-Identifier: Apache-2.0
/**
 * T17：助手联网源（DeepSeek）在设置页**可见**、且**默认不勾选**。
 *
 * 改造前这个来源只有"配过才知道存在"——`deepseek` 一直是 `SearchConfig.sources` 里可选
 * 的一项，但没有任何文案告诉用户它在那儿。这一条用两个断言把口径钉住：
 *
 * 1. 默认配置（Bing + DuckDuckGo）下，DeepSeek 那一格的勾选框存在且未勾选；
 * 2. 勾上之后保存出去的 `sources` 里出现 `deepseek`（后端 `source_status` 才会带上它）。
 *
 * 单独成一个文件而不是往 `SearchCard.test.tsx` 里塞：那份已经接近 500 行预算，而这里
 * 要守的是一条**独立的产品口径**（可见 + 默认关），失败时应一眼看出是哪条口径破了。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchCard from "./SearchCard";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({
  getSearchConfig: vi.fn(),
  saveSearchConfig: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

/** 与后端 `SearchConfig` 的出厂默认一致：DeepSeek **不在**里面。 */
const stored = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  depth: "standard",
  max_results: 8,
  deepseek_api_key: "",
  tavily_api_key: "",
  jina_api_key: "",
};

function renderCard() {
  return render(
    <AntdApp>
      <SearchCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.getSearchConfig.mockResolvedValue(stored);
  apiMocks.saveSearchConfig.mockImplementation(async (config) => config);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("助手联网源（T17）", () => {
  it("shows the DeepSeek source even when nothing is configured, and leaves it unchecked", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getSearchConfig).toHaveBeenCalledOnce());

    // 品牌名在两种语言下同形，界面直接用 `searchCard.source.deepseek` 这份译文。
    const deepseek = await screen.findByRole("checkbox", {
      name: t("searchCard.source.deepseek"),
    });
    expect(deepseek).not.toBeChecked();
    // 出厂默认的两个来源仍在，说明"可见"不是靠把别的来源挤掉换来的。
    expect(screen.getByRole("checkbox", { name: "Bing" })).toBeChecked();
  });

  it("adds deepseek to the saved sources once the user opts in", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getSearchConfig).toHaveBeenCalledOnce());

    fireEvent.click(await screen.findByRole("checkbox", { name: t("searchCard.source.deepseek") }));

    await waitFor(() =>
      expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sources: ["bing", "duckduckgo", "deepseek"] }),
      ),
    );
  });
});
