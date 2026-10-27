// SPDX-License-Identifier: Apache-2.0
/**
 * 「填充记录」面板的最小渲染用例。
 *
 * 为什么只覆盖三件事：这个面板此前**全仓零测试引用**，31 处 `t()` 只靠静态检查兜底。
 * 这三条挑的是「一改就坏、坏了不易发现」的三处——摘要行的三个计数 Tag、两处删除确认
 * 文案、以及批量选择从「没勾选」到「可删除」的状态。图省事不做键盘/布局断言。
 *
 * 断言一律走 `t("webFormRecords.…")` 取词表值，不钉中文：以后改文案不该连带红。
 * mock 形状与 `WebFormPage.records.test.tsx` 一致（同一批 API）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebFormFillRecord, WebFormRecordSummary } from "../../types";
import { TRASH_RECOVERY_NOTE } from "../common/rowActionMenu";
import { t } from "../../i18n";
import WebFormRecordsPanel from "./WebFormRecordsPanel";

const apiMocks = vi.hoisted(() => ({
  listWebFormRecordsPage: vi.fn(),
  getWebFormRecord: vi.fn(),
  deleteWebFormRecord: vi.fn(),
}));

vi.mock("../../api/webform", () => apiMocks);

/**
 * antd 会在两个中文字之间插一个空格（按钮「两字间距」），可访问名因此是「删 除」。
 * 逐字之间允许空白即可，英文名不受影响（`\s*` 允许零个空白）。
 */
function buttonName(text: string): RegExp {
  return new RegExp(Array.from(text).join("\\s*"));
}

function summary(overrides: Partial<WebFormRecordSummary> = {}): WebFormRecordSummary {
  return {
    id: 1,
    url: "https://example.com/apply",
    page_title: "Acme Careers",
    filled: 3,
    unverified: 1,
    failed: 1,
    source: "live",
    created_at: "2026-10-27T09:30:00",
    ...overrides,
  };
}

/** 详情端点：点开某一条时会去取明细，缺了它 `getWebFormRecord(...).then` 会炸。 */
function fullRecord(overrides: Partial<WebFormRecordSummary> = {}): WebFormFillRecord {
  return { ...summary(overrides), items: [], page_snapshot: [] };
}

/**
 * 断言弹窗里出现了某段文案。
 *
 * antd 的 Modal.confirm 会把标题渲染两次（可见标题 + 供读屏关联的标题节点），
 * `getByText` 会因命中两个而抛错，所以这里要求「至少一处」——仍然要求它真的渲染出来。
 */
function expectDialogText(dialog: HTMLElement, text: string): void {
  expect(within(dialog).getAllByText(text).length).toBeGreaterThan(0);
}

function renderPanel() {
  return render(
    <AntdApp>
      <WebFormRecordsPanel />
    </AntdApp>,
  );
}

describe("WebFormRecordsPanel", () => {
  beforeEach(() => {
    // total 刻意大于一页：分页条只在多页时渲染，单页会 hideOnSinglePage 收起。
    apiMocks.listWebFormRecordsPage.mockResolvedValue({ items: [summary()], total: 45 });
    apiMocks.getWebFormRecord.mockResolvedValue(fullRecord());
    apiMocks.deleteWebFormRecord.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("摘要行渲染页面标题与成功 / 待核对 / 失败三个计数", async () => {
    renderPanel();

    expect(await screen.findByText("Acme Careers")).toBeInTheDocument();
    expect(screen.getByText(t("webFormRecords.tag.filled", { count: 3 }))).toBeInTheDocument();
    expect(screen.getByText(t("webFormRecords.tag.unverified", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("webFormRecords.tag.failed", { count: 1 }))).toBeInTheDocument();
    // 「逐项填」来源标记与分页总数也走词表：这两处最容易在改文案时被漏掉。
    expect(screen.getByText(t("webFormRecords.tag.live"))).toBeInTheDocument();
    expect(
      screen.getByText(t("webFormRecords.pagination.total", { count: 45 })),
    ).toBeInTheDocument();
  });

  it("单条删除：右键菜单给出的确认文案出现在弹窗里", async () => {
    renderPanel();

    fireEvent.contextMenu(await screen.findByText("Acme Careers"));
    fireEvent.click(await screen.findByText(t("common.action.delete")));

    const dialog = await screen.findByRole("dialog");
    expectDialogText(dialog, t("webFormRecords.confirm.deleteOne"));
  });

  it("批量删除：勾选后按钮可用，确认正文带上条数，删完清空选择", async () => {
    apiMocks.listWebFormRecordsPage.mockResolvedValue({
      items: [summary(), summary({ id: 2, page_title: "Beta Careers" })],
      total: 45,
    });
    renderPanel();

    fireEvent.contextMenu(await screen.findByText("Acme Careers"));
    fireEvent.click(await screen.findByText(t("common.action.batchSelect")));

    const deleteSelected = screen.getByRole("button", {
      name: t("webFormRecords.action.deleteSelected"),
    });
    // 没勾选时不能删——这是批量选择唯一的保护。
    expect(deleteSelected).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: t("webFormRecords.aria.selectRecord", { id: 2 }),
      }),
    );
    expect(deleteSelected).toBeEnabled();

    fireEvent.click(deleteSelected);
    const dialog = await screen.findByRole("dialog");
    expectDialogText(dialog, t("webFormRecords.confirm.batchTitle"));
    // 正文里的条数来自勾选数量，跟着选择走。
    expectDialogText(
      dialog,
      t("webFormRecords.confirm.batchBody", { count: 1, note: TRASH_RECOVERY_NOTE }),
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: buttonName(t("common.action.delete")) }),
    );
    await waitFor(() => expect(apiMocks.deleteWebFormRecord).toHaveBeenCalledTimes(1));
    expect(apiMocks.deleteWebFormRecord).toHaveBeenCalledWith(2);
  });
});
