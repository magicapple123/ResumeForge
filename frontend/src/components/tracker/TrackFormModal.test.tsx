/**
 * 进度记录表单：**投递日期那一栏的取舍**。
 *
 * 这一栏是求职统计页两张图的唯一数据来源，留空就等于把自己排除在统计之外。所以这里钉两件事：
 * 1. 留空的**后果**写在字段旁（此前只写「YYYY-MM-DD」，用户看不到代价）；
 * 2. 提供一键填入今天，但**不预填**——手工录入不知道真实投递日期，替用户填今天会在
 *    趋势图里造出一个从未发生过的尖峰。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrackFormModal from "./TrackFormModal";
import { getTrack } from "../../api/tracker";
import { todayIsoDate } from "../../utils/format";
import type { Track } from "../../types";

vi.mock("../../api/tracker", () => ({
  createTrack: vi.fn(),
  getTrack: vi.fn(),
  updateTrack: vi.fn(),
}));

function renderModal() {
  return render(
    <AntdApp>
      <TrackFormModal open track={null} onClose={() => {}} onSaved={() => {}} />
    </AntdApp>,
  );
}

/** 列表行的形态：note/evidence 可能被后端截成预览（…结尾）。 */
const LISTED_ROW: Track = {
  id: 7,
  company: "示例科技",
  title: "后端开发实习生",
  status: "applied",
  stage_note: "",
  applied_at: "2026-09-18",
  status_date: "",
  next_action: "",
  next_action_date: "",
  note: "很长的备注预览…",
  evidence: "",
  job_id: null,
  resume_id: null,
  source: "manual",
  created_at: "2026-09-18T08:00:00",
  updated_at: "2026-09-18T08:00:00",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("TrackFormModal 的投递日期", () => {
  it("说明留空的后果，而不是只写个格式", async () => {
    renderModal();

    expect(
      await screen.findByText(/留空表示日期不详——该记录不计入投递趋势与周内分布/),
    ).toBeInTheDocument();
  });

  it("新增时不预填今天，日期栏保持空着", async () => {
    renderModal();

    // E12 起投递日期换成 DatePicker，用标签定位而不是占位文本。
    const input = await screen.findByLabelText("投递日期");
    // 预填今天会把"三周后照通知补录"的记录钉在错误的月份上。
    expect(input).toHaveValue("");
  });

  it("点「填今天」把本地当天日期填进去，用户仍可改", async () => {
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "填今天" }));

    // 用本地日期而不是 UTC：晚上录的记录不该被写成"昨天"。
    await waitFor(() => expect(screen.getByLabelText("投递日期")).toHaveValue(todayIsoDate()));
  });

  it("编辑时从详情接口取全文回填——列表行的 note 是截断预览，不能拿它当编辑底稿", async () => {
    vi.mocked(getTrack).mockResolvedValue({ ...LISTED_ROW, note: "完整备注全文" });
    render(
      <AntdApp>
        <TrackFormModal open track={LISTED_ROW} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );

    // 详情请求回来后覆盖乐观预填的截断预览；保存（PUT 整体替换）以全文为准。
    await waitFor(() => expect(screen.getByLabelText("备注")).toHaveValue("完整备注全文"));
    expect(getTrack).toHaveBeenCalledWith(7);
  });
});
