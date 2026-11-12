// SPDX-License-Identifier: Apache-2.0
/**
 * 「表达资产库」面板（W17）：四态、筛选、三个动作回调、插入禁用原因。
 *
 * 所有可见文案从 `at()` 取（与组件同源），测试里不写中文：改文案只改语言包。
 * 数据用 `mockPhrases` 的**虚构英文样例**（`src/` 下不许出现中文样本，见该文件头注释）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { at } from "./i18n";
import { MOCK_PHRASES } from "./mockPhrases";
import PhraseLibraryPanel from "./PhraseLibraryPanel";

function renderPanel(overrides: Partial<React.ComponentProps<typeof PhraseLibraryPanel>> = {}) {
  const handlers = {
    onInsert: vi.fn(),
    onRequestDelete: vi.fn(),
    onCopy: vi.fn(),
    onRetry: vi.fn(),
    onCollectCurrent: vi.fn(),
  };
  const props: React.ComponentProps<typeof PhraseLibraryPanel> = {
    phrases: MOCK_PHRASES,
    insertEnabled: true,
    ...handlers,
    ...overrides,
  };
  const view = render(
    <AntdApp>
      <PhraseLibraryPanel {...props} />
    </AntdApp>,
  );
  return { ...handlers, ...view };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("PhraseLibraryPanel · 四态", () => {
  it("加载中显示加载态（role=status）", () => {
    renderPanel({ phrases: [], loading: true });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(at("assets.empty"))).toBeNull();
  });

  it("错误态优先于空态，并带重试", () => {
    const onRetry = vi.fn();
    renderPanel({ phrases: [], error: "network down", onRetry });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: at("assets.error.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(at("assets.empty"))).toBeNull();
  });

  it("一条都没有：空态 + 收藏指引，且不渲染筛选条", () => {
    renderPanel({ phrases: [] });
    expect(screen.getByText(at("assets.empty"))).toBeTruthy();
    expect(screen.queryByLabelText(at("assets.filter.search"))).toBeNull();
  });

  it("有数据：渲染全部卡片与计数", () => {
    renderPanel();
    expect(screen.getByText(at("assets.list.count", { count: MOCK_PHRASES.length }))).toBeTruthy();
    for (const phrase of MOCK_PHRASES) {
      expect(screen.getByText(phrase.text)).toBeTruthy();
    }
  });
});

describe("PhraseLibraryPanel · 筛选", () => {
  it("关键词筛选同时命中正文与标签", () => {
    renderPanel();
    const search = screen.getByLabelText(at("assets.filter.search"));
    fireEvent.change(search, { target: { value: "latency" } });
    expect(screen.getByText(MOCK_PHRASES[0].text)).toBeTruthy();
    expect(screen.queryByText(MOCK_PHRASES[2].text)).toBeNull();

    fireEvent.change(search, { target: { value: "sre" } });
    expect(screen.getByText(MOCK_PHRASES[2].text)).toBeTruthy();
    expect(screen.queryByText(MOCK_PHRASES[0].text)).toBeNull();
  });

  it("筛选后为空时给「清空筛选」而不是「还没有收藏」", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(at("assets.filter.search")), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.getByText(at("assets.empty.filtered"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: at("assets.empty.filteredAction") }));
    expect(screen.getByText(MOCK_PHRASES[0].text)).toBeTruthy();
  });
});

describe("PhraseLibraryPanel · 动作与禁用", () => {
  it("插入回调带整条资产（宿主负责生成新身份）", () => {
    const { onInsert } = renderPanel();
    const first = screen.getAllByRole("button", {
      name: at("assets.action.insertAria", { index: 1 }),
    })[0];
    fireEvent.click(first);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect((onInsert.mock.calls[0][0] as { id: number }).id).toBe(MOCK_PHRASES[0].id);
  });

  it("没有可插入的简历时按钮禁用并给出原因", () => {
    const { onInsert } = renderPanel({ insertEnabled: false });
    const button = screen.getByRole("button", {
      name: at("assets.action.insertAria", { index: 1 }),
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("删除与复制收在「⋯」菜单里，点击仍只是回调（#19）", async () => {
    const { onRequestDelete, onCopy } = renderPanel();
    fireEvent.click(
      screen.getAllByRole("button", { name: at("assets.action.moreAria", { index: 1 }) })[0],
    );
    fireEvent.click(await screen.findByText(at("assets.action.delete")));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getAllByRole("button", { name: at("assets.action.moreAria", { index: 1 }) })[0],
    );
    fireEvent.click(await screen.findByText(at("assets.action.copy")));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("宿主没提供任何卡片动作回调时不渲染「⋯」入口", () => {
    renderPanel({ onCopy: undefined, onRequestDelete: undefined, onEdit: undefined });
    expect(
      screen.queryByRole("button", { name: at("assets.action.moreAria", { index: 1 }) }),
    ).toBeNull();
  });

  it("收藏入口只在宿主提供回调时出现", () => {
    const { unmount } = renderPanel({ onCollectCurrent: undefined });
    expect(screen.queryByRole("button", { name: at("assets.action.collectAria") })).toBeNull();
    unmount();
    const withCollect = renderPanel();
    const collect = screen.getByRole("button", { name: at("assets.action.collectAria") });
    fireEvent.click(collect);
    expect(withCollect.onCollectCurrent).toHaveBeenCalledTimes(1);
  });

  it("卡片把标签渲染成可见徽标（不只是颜色）", () => {
    renderPanel();
    const firstCard = screen
      .getByText(MOCK_PHRASES[0].text)
      .closest("[data-phrase-id]") as HTMLElement;
    expect(within(firstCard).getByText("backend")).toBeTruthy();
    const meta = firstCard.querySelector(".resume-phrase-card-meta") as HTMLElement;
    expect(meta.textContent).toContain(
      at("assets.meta.kind", { value: at("assets.kind.achievement") }),
    );
  });

  it("#19：卡片元信息读出类型 / 语言 / 来源 / 已用于 N 份简历四个维度", () => {
    renderPanel();
    const firstCard = screen
      .getByText(MOCK_PHRASES[0].text)
      .closest("[data-phrase-id]") as HTMLElement;
    const meta = firstCard.querySelector(".resume-phrase-card-meta") as HTMLElement;
    expect(meta.textContent).toContain(
      at("assets.meta.language", { value: at("assets.language.en-US") }),
    );
    expect(meta.textContent).toContain(
      at("assets.meta.source", { value: at("assets.source.claim") }),
    );
    expect(meta.textContent).toContain(
      at("assets.meta.usage", { count: MOCK_PHRASES[0].usage_count }),
    );
  });

  it("#19：未标注语言时读作「语言：未标注」而不是裸词", () => {
    renderPanel();
    const unlabeled = screen
      .getByText(MOCK_PHRASES[4].text)
      .closest("[data-phrase-id]") as HTMLElement;
    const meta = unlabeled.querySelector(".resume-phrase-card-meta") as HTMLElement;
    expect(meta.textContent).toContain(
      at("assets.meta.language", { value: at("assets.language.unknown") }),
    );
  });

  it("#19：没选中要点时收藏按钮禁用 + 给出原因，而不是整块不渲染", () => {
    const { onCollectCurrent } = renderPanel({
      collectEnabled: false,
      collectDisabledReason: at("assets.collect.needSelection"),
    });
    const collect = screen.getByRole("button", { name: at("assets.action.collectAria") });
    expect(collect).toBeDisabled();
    fireEvent.click(collect);
    expect(onCollectCurrent).not.toHaveBeenCalled();
  });
});
