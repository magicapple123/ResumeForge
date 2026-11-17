// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态右卡「最近填写」（T08）。
 *
 * 守三件事：
 * 1. 0 条时给完整空态（标题 + 「会发生什么」+ 次要入口），「查看全部」disabled 而不隐藏；
 * 2. 有条目时最多铺 3 条，每条固定行高、显示时间/页面/成功计数；
 * 3. 「看看打开过的网址」复用地址栏那份 urlHistory，选中即回填。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webFormPageZh from "../../i18n/messages/zh-CN.webFormPage";
import webFormRecordsZh from "../../i18n/messages/zh-CN.webFormRecords";
import { WebFormRecentRecords } from "./WebFormRecentRecords";
import type { WebFormUrlHistory } from "../../types";

const apiMocks = vi.hoisted(() => ({ listWebFormRecordsPage: vi.fn() }));

vi.mock("../../api/webform", () => apiMocks);

const zh = webFormPageZh;
const recordsZh = webFormRecordsZh;

const HISTORY: WebFormUrlHistory[] = [
  { id: 1, url: "https://example.com/job/1", title: "opened-company", last_used_at: "" },
];

function record(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    url: "",
    page_title: `record-${id}`,
    filled: id,
    unverified: 0,
    failed: 0,
    source: "batch",
    created_at: "2026-09-27T10:30:00",
    ...overrides,
  };
}

function renderCard(overrides: Partial<Parameters<typeof WebFormRecentRecords>[0]> = {}) {
  const onViewAll = vi.fn();
  const onUseUrl = vi.fn();
  render(
    <AntdApp>
      <WebFormRecentRecords
        urlHistory={[]}
        onViewAll={onViewAll}
        onUseUrl={onUseUrl}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onViewAll, onUseUrl };
}

beforeEach(() => {
  apiMocks.listWebFormRecordsPage.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WebFormRecentRecords", () => {
  it("empty: explains what happens and keeps View all visible but disabled", async () => {
    renderCard();

    expect(await screen.findByText(recordsZh["webFormRecords.empty.none"])).toBeInTheDocument();
    expect(screen.getByText(zh["webFormPage.recent.emptyWhat"])).toBeInTheDocument();
    expect(screen.getByText(zh["webFormPage.recent.emptyBody"])).toBeInTheDocument();

    const viewAll = screen.getByRole("button", { name: zh["webFormPage.recent.viewAll"] });
    expect(viewAll).toBeInTheDocument();
    expect(viewAll).toBeDisabled();
  });

  it("renders at most three rows with time, page and filled count", async () => {
    apiMocks.listWebFormRecordsPage.mockResolvedValue({
      items: [record(1), record(2), record(3), record(4), record(5)],
      total: 5,
    });
    renderCard();

    expect(await screen.findByText("record-1")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("record-4")).toBeNull();
    expect(
      screen.getByText(recordsZh["webFormRecords.tag.filled"].replace("{count}", "1")),
    ).toBeInTheDocument();
  });

  it("View all is clickable only with records and hands off to the page", async () => {
    apiMocks.listWebFormRecordsPage.mockResolvedValue({ items: [record(1)], total: 1 });
    const { onViewAll } = renderCard();

    const viewAll = await screen.findByRole("button", { name: zh["webFormPage.recent.viewAll"] });
    await waitFor(() => expect(viewAll).toBeEnabled());
    fireEvent.click(viewAll);

    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it("the empty state reuses the URL history and fills the address back", async () => {
    const { onUseUrl } = renderCard({ urlHistory: HISTORY });

    const entry = await screen.findByRole("button", { name: zh["webFormPage.recent.urls"] });
    expect(entry).toBeEnabled();
    fireEvent.click(entry);

    fireEvent.click(await screen.findByText("opened-company"));
    expect(onUseUrl).toHaveBeenCalledWith(HISTORY[0]);
  });

  it("the URL history entry is disabled when there is nothing to show", async () => {
    renderCard();
    const entry = await screen.findByRole("button", { name: zh["webFormPage.recent.urls"] });
    expect(entry).toBeDisabled();
  });
});
