/** 内推管理面板：列表 + 转化率卡 + 删除（软删）+ 状态分色 + 图片备注上传。 */
import { App as AntApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReferralPanel from "./ReferralPanel";
import { REFERRAL_STATUS_COLORS } from "../types";

const apiMocks = vi.hoisted(() => ({
  listReferralsPage: vi.fn(),
  getReferralStats: vi.fn(),
  createReferral: vi.fn(),
  updateReferral: vi.fn(),
  deleteReferral: vi.fn(),
  batchDeleteReferrals: vi.fn(),
  uploadReferralImage: vi.fn(),
}));

vi.mock("../api/referrals", () => apiMocks);

const ITEMS = [
  {
    id: 1,
    job_id: null,
    job_title: "",
    company: "示例公司",
    referrer_name: "张三",
    referrer_contact: "微信 zs",
    relation: "前同事",
    position: "后端开发",
    channel: "牛客",
    status: "active",
    track_id: null,
    converted: true,
    submitted_at: "",
    note: "",
    created_at: "2026-09-19T08:00:00",
    updated_at: "2026-09-19T08:00:00",
  },
];

const STATS = { total: 4, converted: 2, rate: 0.5 };

function renderPanel() {
  return render(
    <AntApp>
      {/* 关联岗位/漏斗下拉已改为内部远程搜索（P0-1），不再从页面传选项。 */}
      <ReferralPanel />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.listReferralsPage.mockReset().mockResolvedValue({ items: ITEMS, total: ITEMS.length });
  apiMocks.getReferralStats.mockReset().mockResolvedValue(STATS);
  apiMocks.deleteReferral.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ReferralPanel", () => {
  it("渲染内推列表与转化率小卡", async () => {
    renderPanel();

    expect(await screen.findByText(/张三 · 后端开发/)).toBeInTheDocument();
    expect(screen.getByText("示例公司 · 前同事 · 牛客")).toBeInTheDocument();
    // 「已转化」既出现在转化率卡标题、也出现在列表的 Tag 上，取任一即可。
    expect(screen.getAllByText("已转化").length).toBeGreaterThan(0);
    // 转化率卡：有效内推 / 已转化 / 转化率。
    expect(screen.getByText("有效内推")).toBeInTheDocument();
    expect(screen.getByText("转化率")).toBeInTheDocument();
    expect(apiMocks.getReferralStats).toHaveBeenCalled();
  });

  it("删除先确认，确认后走软删除并刷新统计", async () => {
    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    fireEvent.click(screen.getByRole("button", { name: "更多操作 张三" }));
    fireEvent.click(await screen.findByText("删除"));

    expect(apiMocks.deleteReferral).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteReferral).toHaveBeenCalledWith(1));
  });

  it("状态分色映射与列表 Tag 颜色一致", async () => {
    expect(REFERRAL_STATUS_COLORS).toEqual({
      active: "blue",
      submitted: "green",
      closed: "default",
      invalid: "red",
    });

    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    // ITEMS 里是 active → 蓝色 Tag。
    expect(screen.getByText("已联系")).toHaveClass("ant-tag-blue");
  });

  it("新增表单含内推码与图片备注上传入口", async () => {
    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    fireEvent.click(screen.getByRole("button", { name: /新增内推/ }));

    expect(await screen.findByLabelText("内推码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /上传备注图/ })).toBeInTheDocument();
  });

  it("上传备注图后出现缩略图，可移除", async () => {
    apiMocks.uploadReferralImage.mockResolvedValue({ path: "referral_images/ab12.png" });
    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    fireEvent.click(screen.getByRole("button", { name: /新增内推/ }));
    // Modal 渲染在 body 门户里，文件输入要查 document 而不是 render 容器。
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["png-bytes"], "note.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => expect(apiMocks.uploadReferralImage).toHaveBeenCalledOnce());
    expect(await screen.findByAltText("备注图 1")).toHaveAttribute(
      "src",
      "/api/referrals/images/ab12.png",
    );
    // 上传结束后进度条消失（uploadPercent 回到 null）。
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "移除备注图 1" }));
    expect(screen.queryByAltText("备注图 1")).not.toBeInTheDocument();
  });

  it("上传中在上传按钮旁显示进度条并随 onProgress 推进（C2）", async () => {
    // 用未 resolve 的 Promise 托住上传过程，手动派发进度事件模拟 XHR 的 upload.onprogress。
    let reportProgress: ((percent: number) => void) | undefined;
    apiMocks.uploadReferralImage.mockImplementation(
      (_file: File, onProgress?: (percent: number) => void) => {
        reportProgress = onProgress;
        return new Promise(() => {});
      },
    );
    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    fireEvent.click(screen.getByRole("button", { name: /新增内推/ }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["png-bytes"], "note.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => expect(apiMocks.uploadReferralImage).toHaveBeenCalledOnce());
    expect(reportProgress).toBeTypeOf("function");
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
    reportProgress!(40);
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"),
    );
    reportProgress!(100);
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"),
    );
  });

  it("点卡片打开详情，看得到联系方式与内推码", async () => {
    apiMocks.listReferralsPage.mockResolvedValue({
      items: [{ ...ITEMS[0], referral_code: "REF-888", note_images: [] }],
      total: 1,
    });
    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    fireEvent.click(screen.getByRole("button", { name: "详情" }));

    // 列表里只有内推人/公司/渠道，联系方式与内推码只在详情里出现。
    expect(await screen.findByText("联系方式")).toBeInTheDocument();
    expect(screen.getByText("微信 zs")).toBeInTheDocument();
    expect(screen.getByText("REF-888")).toBeInTheDocument();
  });

  it("批量选择：右键进多选 → 勾 2 条 → 删除所选（确认文案带数量）→ 一次批量删除请求带全部 id 并刷新", async () => {
    apiMocks.listReferralsPage.mockResolvedValue({
      items: [ITEMS[0], { ...ITEMS[0], id: 2, referrer_name: "李四", converted: false }],
      total: 2,
    });
    apiMocks.batchDeleteReferrals.mockResolvedValue({ deleted: 2 });
    renderPanel();
    await screen.findByText(/张三 · 后端开发/);

    fireEvent.contextMenu(screen.getByText(/张三 · 后端开发/));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: "选择内推 张三" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择内推 李四" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    // Popconfirm 确认（文案带数量）；确认前绝不发请求。
    const popover = await waitFor(() => {
      const root = document.querySelector(".ant-popover");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(popover.textContent).toContain("删除选中的 2 条内推");
    expect(apiMocks.batchDeleteReferrals).not.toHaveBeenCalled();
    fireEvent.click(within(popover).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => {
      expect(apiMocks.batchDeleteReferrals).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.batchDeleteReferrals).toHaveBeenCalledWith([1, 2]);
    // 成功后清空选择、重拉列表与统计。
    expect(await screen.findByText(/已删除 2 条内推/)).toBeInTheDocument();
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.listReferralsPage.mock.calls.length).toBeGreaterThan(1);
      expect(apiMocks.getReferralStats.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("服务端分页：默认每页 10 条，翻页携带 page 重新请求", async () => {
    apiMocks.listReferralsPage.mockResolvedValue({ items: ITEMS, total: 25 });
    renderPanel();
    expect(await screen.findByText(/张三 · 后端开发/)).toBeInTheDocument();
    expect(apiMocks.listReferralsPage).toHaveBeenLastCalledWith(
      { status: undefined, keyword: "" },
      1,
      10,
    );

    fireEvent.click(screen.getByTitle("2"));
    await waitFor(() => {
      expect(apiMocks.listReferralsPage).toHaveBeenLastCalledWith(
        { status: undefined, keyword: "" },
        2,
        10,
      );
    });
  });
});
