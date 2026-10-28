// SPDX-License-Identifier: Apache-2.0
/**
 * 联网搜索设置卡片。
 *
 * 重点在"改得动、改得对"：这几个参数此前只有后端接口、没有任何界面入口，
 * 「抓取正文的条数」永远是默认的 0。所以这里断言的是保存出去的那份 payload，
 * 而不是界面上显示了什么。
 *
 * 交互口径（2026-10 改）：字段常驻可编辑，**没有保存/恢复按钮**；改动合并 400ms
 * 后自动保存，校验失败只在卡片底部说明。
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

const stored = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  fetch_pages: 0,
  max_results: 8,
};

function renderCard() {
  return render(
    <AntdApp>
      <SearchCard />
    </AntdApp>,
  );
}

/** 等首次取数落地：加载中时字段是空的，直接断言会看到默认值。 */
async function waitLoaded() {
  await waitFor(() => expect(apiMocks.getSearchConfig).toHaveBeenCalledOnce());
  await screen.findByPlaceholderText("http://localhost:8080");
}

beforeEach(() => {
  apiMocks.getSearchConfig.mockResolvedValue(stored);
  apiMocks.saveSearchConfig.mockImplementation(async (config) => config);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SearchCard", () => {
  it("loads the saved setting instead of showing defaults", async () => {
    apiMocks.getSearchConfig.mockResolvedValue({
      ...stored,
      sources: ["bing", "searxng"],
      searxng_url: "http://localhost:8080",
      fetch_pages: 2,
      max_results: 12,
    });

    renderCard();

    await waitFor(() => expect(apiMocks.getSearchConfig).toHaveBeenCalledOnce());
    // 抓取正文那组是单选，要看勾中的那一项是不是服务端存的那一项。
    expect(await screen.findByRole("checkbox", { name: "抓前 2 条正文" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "只取摘要（最快）" })).not.toBeChecked();
    expect(screen.getByPlaceholderText("http://localhost:8080")).toHaveValue(
      "http://localhost:8080",
    );
  });

  it("saves the page-fetch count automatically after a change", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "抓前 2 条正文" }));

    // 这是本次修复的核心：抓取正文的条数以前没有任何界面能改，永远是 0。
    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ fetch_pages: 2 }),
        ),
      { timeout: 2500 },
    );
    expect(await screen.findByText(t("searchCard.saved"))).toBeInTheDocument();
  });

  it("keeps the source list the user checked", async () => {
    renderCard();
    await waitLoaded();

    // 取消 DuckDuckGo，只留 Bing。
    fireEvent.click(screen.getByRole("checkbox", { name: "DuckDuckGo" }));

    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ sources: ["bing"] }),
        ),
      { timeout: 2500 },
    );
  });

  it("refuses to save an empty source list", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "Bing" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "DuckDuckGo" }));

    // 后端 sources 要求至少一项，前端先拦下来，别让用户收到一个 422。
    expect(await screen.findByText(t("searchCard.needSource"))).toBeInTheDocument();
    expect(apiMocks.saveSearchConfig).not.toHaveBeenCalled();
  });

  it("refuses a SearXNG address without a scheme", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: /SearXNG/ }));
    fireEvent.change(screen.getByPlaceholderText("http://localhost:8080"), {
      target: { value: "localhost:8080" },
    });

    expect(
      await screen.findByText("SearXNG 地址要以 http:// 或 https:// 开头"),
    ).toBeInTheDocument();
    expect(apiMocks.saveSearchConfig).not.toHaveBeenCalled();
  });

  it("trims the SearXNG address before saving", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: /SearXNG/ }));
    fireEvent.change(screen.getByPlaceholderText("http://localhost:8080"), {
      target: { value: "  http://localhost:8888  " },
    });

    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ searxng_url: "http://localhost:8888" }),
        ),
      { timeout: 2500 },
    );
  });

  it("has no save or reset buttons: editing in place is the only workflow", async () => {
    renderCard();
    await waitLoaded();

    expect(screen.queryByRole("button", { name: /编辑搜索设置/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /保存搜索设置/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /恢复为已保存值/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "DuckDuckGo" })).toBeEnabled();
  });

  it("keeps the SearXNG address field disabled until that source is checked", async () => {
    renderCard();
    await waitLoaded();

    // 这条不是"编辑门禁"：未勾选 SearXNG 时填地址没有意义，勾上就解锁。
    expect(screen.getByPlaceholderText("http://localhost:8080")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /SearXNG/ }));
    expect(screen.getByPlaceholderText("http://localhost:8080")).toBeEnabled();
  });

  it("tells the user when the saved setting could not be read", async () => {
    apiMocks.getSearchConfig.mockRejectedValue(new Error("后端没有响应"));

    renderCard();

    // 取不到就退回默认值可以，但不能让人以为屏幕上这份就是自己存过的设置。
    expect(await screen.findByText(t("searchCard.loadErrorTitle"))).toBeInTheDocument();
    expect(screen.getByText(/后端没有响应/)).toBeInTheDocument();
  });
});
