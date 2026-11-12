// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoUnfocusableScroller } from "../../../test/a11yScrollRegion";
import type { DeliverySummary } from "../../../types";
import { t } from "../../../i18n";

const apiMocks = vi.hoisted(() => ({
  listDeliveryArchive: vi.fn(),
  downloadDelivery: vi.fn(),
}));
const downloadBlob = vi.hoisted(() => vi.fn());

vi.mock("../../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/resumes")>()),
  listDeliveryArchive: apiMocks.listDeliveryArchive,
  downloadDelivery: apiMocks.downloadDelivery,
}));

vi.mock("../../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/download")>()),
  downloadBlob,
}));

import DeliveryArchiveModal from "./DeliveryArchiveModal";

const ITEM: DeliverySummary = {
  id: 7,
  created_at: "2026-10-13T08:00:00Z",
  source: "track",
  job_title: "后端开发",
  company: "示例公司",
  resume_title: "后端岗位简历",
  export_format: "",
  filename: "",
  pages: null,
  content_sha256: "a".repeat(64),
  rendered_config_sha256: "b".repeat(64),
};

function renderModal() {
  return render(
    <AntdApp>
      <DeliveryArchiveModal onClose={() => {}} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listDeliveryArchive.mockReset().mockResolvedValue({ items: [ITEM], total: 1 });
  apiMocks.downloadDelivery.mockReset().mockResolvedValue({
    blob: new Blob(["synthetic archive"]),
    filename: "delivery.json",
    replayed: false,
  });
  downloadBlob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("DeliveryArchiveModal", () => {
  it("loads historical evidence, keeps filtering literal, and downloads the selected record", async () => {
    renderModal();
    await screen.findByText("后端岗位简历");
    expect(screen.getByText(/原简历删除后仍可查找历史存档/)).toBeTruthy();

    const search = screen.getByRole("searchbox", { name: "搜索交付存档" });
    fireEvent.change(search, { target: { value: "%" } });
    fireEvent.keyDown(search, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(apiMocks.listDeliveryArchive).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 10,
        keyword: "%",
        source: "",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "下载存档" }));
    await waitFor(() => expect(apiMocks.downloadDelivery).toHaveBeenCalledWith(7));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "delivery.json");
  });

  it("shows a load error and recovers through the visible retry action", async () => {
    apiMocks.listDeliveryArchive
      .mockRejectedValueOnce(new Error("synthetic network failure"))
      .mockResolvedValueOnce({ items: [ITEM], total: 1 });
    renderModal();

    expect(await screen.findByText("交付存档加载失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /刷\s*新/ }));
    await waitFor(() => expect(screen.getByText("后端岗位简历")).toBeTruthy());
    expect(screen.queryByText("交付存档加载失败")).toBeNull();
  });
});

/**
 * 横向滚动区（C-20 收尾核验）。
 *
 * `scroll={{ x: 600 }}` 让 antd 把表格放进带 `overflow-x: auto` 的 `.ant-table-content`，
 * 但这个容器没有 tabindex。存档为空时区内一个可聚焦元素都没有，窄窗 / 200% 缩放下容器
 * 收窄到 600px 以下就会命中 axe 的 `scrollable-region-focusable`（WCAG 2.1.1，serious）。
 * 弹窗渲染在 portal 里，只能从 `document` 上查，`render` 返回的 container 查不到。
 */
describe("DeliveryArchiveModal 横向滚动区（a11y）", () => {
  it("存档为空：不产生「可横滚、区内却无可聚焦元素」的容器（axe scrollable-region-focusable）", async () => {
    apiMocks.listDeliveryArchive.mockResolvedValue({ items: [], total: 0 });
    renderModal();
    // 等首屏请求落地：加载中与加载完是两种 DOM，别把骨架当成终态。
    await screen.findByRole("searchbox", { name: "搜索交付存档" });
    await waitFor(() => expect(document.querySelector(".ant-table-placeholder")).not.toBeNull());

    expectNoUnfocusableScroller(document);
  });

  it("有存档时保持原行为：770px 定宽 + 横向滚动，区内有「下载存档」按钮可聚焦", async () => {
    renderModal();
    // 用 role 定位等待首屏落地，不用中文文案做 ByText 断言（i18n 棘轮只降不升）。
    await screen.findByRole("button", { name: "下载存档" });

    const content = document.querySelector<HTMLElement>(".ant-table-content");
    expect(content?.style.overflowX).toBe("auto");
    expect(document.querySelector<HTMLElement>(".ant-table table")?.style.width).toBe("770px");
    expect(screen.getByRole("button", { name: "下载存档" })).toBeEnabled();
  });
});

/**
 * 排版（问题 17）。
 *
 * 三条都要守住：说明条只占一行（默认收起）、五列定宽合计 770（否则长文本重新把行高
 * 撑回 200px）、单页不出分页器。列宽那条用 `colgroup` 的实测宽度而不是读源码，
 * 防止以后有人删掉 `width` 又退回自动布局。
 */
describe("DeliveryArchiveModal 排版（问题 17）", () => {
  async function ready() {
    renderModal();
    await screen.findByRole("button", { name: t("delivery.archive.download") });
    await waitFor(() => expect(document.querySelector(".ant-table-row")).not.toBeNull());
  }

  it("说明条默认收起，点开后才渲染正文", async () => {
    await ready();
    const noticeBody = t("delivery.archive.noticeBody");
    expect(screen.queryByText(noticeBody)).toBeNull();

    // antd 的 Collapse 头部不是 button role，按类名点它（标题文本已经断言在上面）。
    const header = document.querySelector<HTMLElement>(".ant-collapse-header");
    expect(header?.textContent).toContain(t("delivery.archive.noticeTitle"));
    fireEvent.click(header as HTMLElement);

    expect(await screen.findByText(noticeBody)).toBeTruthy();
  });

  it("五列定宽合计 770，与 scroll.x 一致", async () => {
    await ready();
    const widths = Array.from(
      document.querySelectorAll<HTMLTableColElement>(".ant-table colgroup col"),
    )
      .slice(0, 5)
      .map((col) => col.style.width);
    expect(widths).toEqual(["210px", "250px", "90px", "110px", "110px"]);
    expect(document.querySelector<HTMLElement>(".ant-table table")?.style.width).toBe("770px");
  });

  it("只有 1 页时不显示分页器，多于 1 页时显示", async () => {
    await ready();
    expect(document.querySelector(".ant-pagination")).toBeNull();

    cleanup();
    document.body.innerHTML = "";
    apiMocks.listDeliveryArchive.mockResolvedValue({ items: [ITEM], total: 25 });
    await ready();
    expect(document.querySelector(".ant-pagination")).not.toBeNull();
  });

  it("导出存档行显示「本地导出（未投递）」，不再拼两个「未记录」", async () => {
    apiMocks.listDeliveryArchive.mockResolvedValue({
      items: [{ ...ITEM, source: "export", company: "", job_title: "" }],
      total: 1,
    });
    await ready();
    expect(screen.getByText(t("delivery.archive.destination.exportOnly"))).toBeTruthy();
  });
});
