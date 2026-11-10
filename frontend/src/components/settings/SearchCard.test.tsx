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
  deepseek_api_key: "",
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
  await screen.findByLabelText(t("searchCard.searxng.title"));
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
    // 抓取正文那组是单选，要看选中的那一项是不是服务端存的那一项。
    expect(await screen.findByRole("radio", { name: "抓前 2 条正文" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "只取摘要（最快）" })).not.toBeChecked();
    expect(screen.getByLabelText(t("searchCard.searxng.title"))).toHaveValue(
      "http://localhost:8080",
    );
  });

  it("saves the page-fetch count automatically after a change", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("radio", { name: "抓前 2 条正文" }));

    // 这是本次修复的核心：抓取正文的条数以前没有任何界面能改，永远是 0。
    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ fetch_pages: 2 }),
        ),
      { timeout: 2500 },
    );
    expect(await screen.findByText(t("searchCard.status.saved"))).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText(t("searchCard.searxng.title")), {
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
    fireEvent.change(screen.getByLabelText(t("searchCard.searxng.title")), {
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
    expect(screen.getByLabelText(t("searchCard.searxng.title"))).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /SearXNG/ }));
    expect(screen.getByLabelText(t("searchCard.searxng.title"))).toBeEnabled();
  });

  it("tells the user when the saved setting could not be read", async () => {
    apiMocks.getSearchConfig.mockRejectedValue(new Error("后端没有响应"));

    renderCard();

    // 取不到就退回默认值可以，但不能让人以为屏幕上这份就是自己存过的设置。
    expect(await screen.findByText(t("searchCard.loadErrorTitle"))).toBeInTheDocument();
    expect(screen.getByText(/后端没有响应/)).toBeInTheDocument();
  });

  it("keeps the DeepSeek key field disabled until that source is checked", async () => {
    renderCard();
    await waitLoaded();

    const field = screen.getByLabelText(t("searchCard.deepseek.keyAria"));
    expect(field).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));
    expect(field).toBeEnabled();
  });

  it("echoes the saved key as a mask and sends it back unchanged", async () => {
    apiMocks.getSearchConfig.mockResolvedValue({
      ...stored,
      sources: ["bing", "deepseek"],
      deepseek_api_key: "********",
    });
    renderCard();
    await waitLoaded();

    // 掩码是服务端唯一会回传的形态；回传时保持原值，后端据此判断"不修改"。
    const field = screen.getByLabelText(t("searchCard.deepseek.keyAria"));
    expect(field).toHaveValue("********");

    fireEvent.click(screen.getByRole("radio", { name: "抓前 1 条正文" }));
    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ deepseek_api_key: "********" }),
        ),
      { timeout: 2500 },
    );
  });

  it("sends a newly typed key to the backend without surrounding spaces", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));
    fireEvent.change(screen.getByLabelText(t("searchCard.deepseek.keyAria")), {
      target: { value: "  sk-live-key  " },
    });

    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ deepseek_api_key: "sk-live-key" }),
        ),
      { timeout: 2500 },
    );
  });

  it("explains billing and the URL sharing next to the DeepSeek key", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));

    expect(screen.getByText(t("searchCard.deepseek.cost"))).toBeInTheDocument();
    expect(screen.getByText(t("searchCard.deepseek.privacy"))).toBeInTheDocument();
  });

  it("paints the selected source tile with the theme-aware brand tint", async () => {
    renderCard();
    await waitLoaded();

    // 回归点 1：选中态曾用 token.colorPrimaryBg（品牌色过深 → antd 算出中灰 #92989c）。
    // 回归点 2：改成 palette.brandTint 后，深色主题下是白底白字（浅色专用 literal 不随主题变）。
    // 所以样式必须引用 CSS 变量，由 design-tokens.css / dark-tokens.css 各自给值。
    const selected = screen
      .getByRole("checkbox", { name: "Bing" })
      .closest('div[style*="background-color"]') as HTMLElement;
    const selectedStyle = selected.getAttribute("style") ?? "";
    expect(selectedStyle).toContain("var(--rf-brand-tint)");
    expect(selectedStyle).toContain("var(--rf-brand)");
    // 反过来钉住：不能再退回浅色专用色值。
    expect(selectedStyle).not.toMatch(/#eaf1f8|rgb\(234, 241, 248\)/i);
    // 1.5px 必须真的生效：写进 border 简写会被归一，选中态就看不出来。
    expect(getComputedStyle(selected).borderTopWidth).toBe("1.5px");

    const unselected = screen
      .getByRole("checkbox", { name: /SearXNG/ })
      .closest('div[style*="background-color"]') as HTMLElement;
    const unselectedStyle = unselected.getAttribute("style") ?? "";
    expect(unselectedStyle).toContain("var(--rf-border)");
    expect(getComputedStyle(unselected).borderTopWidth).toBe("1px");
  });

  it("shows how many sources are selected and keeps it in sync", async () => {
    renderCard();
    await waitLoaded();

    // 卡头的「已选 N 个」是多选卡片的唯一汇总：勾掉一个要立刻变。
    expect(screen.getByText(t("searchCard.sources.count", { count: 2 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "DuckDuckGo" }));
    expect(
      await screen.findByText(t("searchCard.sources.count", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "DuckDuckGo" })).not.toBeChecked();
  });

  it("reports the auto-save status in three states: saving, saved, failed", async () => {
    // 用对象持有 reject：直接把闭包赋值给局部变量，TS 会把它收窄成 never（赋值发生在回调里）。
    const gate: { reject: ((reason: Error) => void) | null } = { reject: null };
    apiMocks.saveSearchConfig.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          gate.reject = reject;
        }),
    );
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));
    // 保存中：卡头右上立刻给出反馈（这张卡没有保存按钮，状态就是唯一的反馈）。
    expect(await screen.findByText(t("searchCard.status.saving"))).toBeInTheDocument();

    gate.reject?.(new Error("save-broken"));
    expect(await screen.findByText(t("searchCard.status.error"))).toBeInTheDocument();
    expect(screen.getByText(/save-broken/)).toBeInTheDocument();
  });

  it("keeps each source's own field inside its card", async () => {
    renderCard();
    await waitLoaded();

    // DeepSeek 的 Key 与 SearXNG 的地址各在自己的卡里；没勾选时都禁用。
    expect(screen.getByLabelText(t("searchCard.deepseek.keyAria"))).toBeDisabled();
    expect(screen.getByLabelText(t("searchCard.searxng.title"))).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));
    expect(screen.getByLabelText(t("searchCard.deepseek.keyAria"))).toBeEnabled();
    expect(screen.getByLabelText(t("searchCard.searxng.title"))).toBeDisabled();
  });

  it("uses a radio group for the page-fetch choice: exactly one option stays selected", async () => {
    renderCard();
    await waitLoaded();

    // 这组值本来就是互斥的，Checkbox 会导致"点已选项取消不了"、语义与外观不符。
    const summaries = screen.getByRole("radio", { name: "只取摘要（最快）" });
    const twoPages = screen.getByRole("radio", { name: "抓前 2 条正文" });
    expect(summaries).toBeChecked();

    fireEvent.click(twoPages);
    expect(twoPages).toBeChecked();
    expect(summaries).not.toBeChecked();

    fireEvent.click(summaries);
    expect(summaries).toBeChecked();
    expect(twoPages).not.toBeChecked();
  });

  it("labels and saves the maximum-results cap (1-50), clamping larger input", async () => {
    renderCard();
    await waitLoaded();

    // 语义是「最多返回」：不再是"每次返回"，因为实际条数受来源与去重限制。
    expect(screen.getByText(t("searchCard.results.title"))).toBeInTheDocument();
    const input = screen.getByLabelText(t("searchCard.results.aria"));

    fireEvent.change(input, { target: { value: "30" } });
    await waitFor(
      () =>
        expect(apiMocks.saveSearchConfig).toHaveBeenCalledWith(
          expect.objectContaining({ max_results: 30 }),
        ),
      { timeout: 2500 },
    );

    // 输入 51：在失焦时夹到上限 50，绝不把越界值发给后端（schema 是 le=50）。
    apiMocks.saveSearchConfig.mockClear();
    fireEvent.change(input, { target: { value: "51" } });
    fireEvent.blur(input);
    await waitFor(() => expect(apiMocks.saveSearchConfig).toHaveBeenCalled(), { timeout: 2500 });
    const caps = apiMocks.saveSearchConfig.mock.calls.map(
      (call) => (call[0] as { max_results: number }).max_results,
    );
    expect(caps).not.toContain(51);
    expect(caps).toContain(50);
  });

  it("does not stretch source tiles to the tall DeepSeek card's height", async () => {
    renderCard();
    await waitLoaded();

    // 布局回归（清单 §4）：等高拉伸 + 卡片 height:100% 会在 SearXNG 卡的输入框下方
    // 留出一大块空白；改成按内容高度排列后，网格必须是 auto-fit + alignItems: start。
    const grid = screen.getByRole("group", { name: t("searchCard.sources.title") });
    expect(grid.style.alignItems).toBe("start");
    expect(grid.style.gridTemplateColumns).toContain("auto-fit");
    expect(grid.style.gridTemplateColumns).toContain("minmax(min(100%, 360px), 1fr)");

    const searxngTile = screen
      .getByRole("checkbox", { name: /SearXNG/ })
      .closest('div[style*="background-color"]') as HTMLElement;
    expect(searxngTile.getAttribute("style") ?? "").not.toContain("height: 100%");
  });

  it("puts the long DeepSeek billing and privacy hints below the source grid", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));

    // 长提示是来源网格的兄弟节点，不是某张卡的子节点——卡片才能按内容收缩。
    const grid = screen.getByRole("group", { name: t("searchCard.sources.title") });
    const cost = screen.getByText(t("searchCard.deepseek.cost"));
    const privacy = screen.getByText(t("searchCard.deepseek.privacy"));
    expect(grid.contains(cost)).toBe(false);
    expect(grid.contains(privacy)).toBe(false);
    // 常驻可见：不能塞进 Tooltip 或折叠区，否则用户根本看不到隐私说明。
    expect(cost.closest('[role="tooltip"]')).toBeNull();
    expect(privacy.closest('[role="tooltip"]')).toBeNull();

    // 取消勾选后两条提示一起消失。
    fireEvent.click(screen.getByRole("checkbox", { name: "DeepSeek" }));
    expect(screen.queryByText(t("searchCard.deepseek.cost"))).toBeNull();
    expect(screen.queryByText(t("searchCard.deepseek.privacy"))).toBeNull();
  });

  it("groups page-fetch and result-cap under the shared parameters heading", async () => {
    renderCard();
    await waitLoaded();

    expect(screen.getByText(t("searchCard.general.title"))).toBeInTheDocument();
    // 两项都在「通用参数」里：抓取档位是单选组，条数上限是数字输入框。
    expect(
      screen.getByRole("radiogroup", { name: t("searchCard.fetch.title") }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(t("searchCard.results.aria"))).toBeInTheDocument();
  });
});
