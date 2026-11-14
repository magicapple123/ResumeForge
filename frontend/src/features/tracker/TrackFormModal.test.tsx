// SPDX-License-Identifier: Apache-2.0
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
import { t } from "../../i18n";

// 这些是 fixture 数据（公司/岗位/简历/备注），不是界面文案：提到常量，
// 断言里不写中文，fixture 与断言也不会各改一半。
const COMPANY = "示例科技";
const JOB_TITLE = "后端开发";
const RESUME_TITLE = "后端岗位简历";
const FULL_NOTE = "完整备注全文";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackFormModal from "./TrackFormModal";
import { createTrack, getTrack, updateTrack } from "../../api/tracker";
import { readDraft, writeDraft } from "../../utils/formDraftStorage";
import { todayIsoDate } from "../../utils/format";
import type { Track } from "../../types";

vi.mock("../../api/tracker", () => ({
  createTrack: vi.fn(),
  getTrack: vi.fn(),
  updateTrack: vi.fn(),
}));

// 岗位/简历下拉已改为组件内部远程搜索（P0-1）：取数与按 id 回查都在这两个 API 模块上。
const jobsMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
}));
const resumesMocks = vi.hoisted(() => ({
  listResumes: vi.fn(),
  getResume: vi.fn(),
}));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);

const JOB_OPTIONS = [
  { id: 11, title: "后端开发", company: "示例科技" },
  { id: 12, title: "前端开发", company: "另一家" },
];
const RESUME_OPTIONS = [
  { id: 3, title: "后端岗位简历" },
  { id: 4, title: "另一版简历" },
];

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: JOB_OPTIONS, total: 2 });
  jobsMocks.getJob
    .mockReset()
    .mockImplementation((id: number) =>
      Promise.resolve(JOB_OPTIONS.find((job) => job.id === id) ?? null),
    );
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: RESUME_OPTIONS, total: 2 });
  resumesMocks.getResume
    .mockReset()
    .mockImplementation((id: number) =>
      Promise.resolve(RESUME_OPTIONS.find((resume) => resume.id === id) ?? null),
    );
});

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
  channel: "unknown",
  resume_title: "",
  source: "manual",
  created_at: "2026-09-18T08:00:00",
  updated_at: "2026-09-18T08:00:00",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("TrackFormModal 的岗位预填", () => {
  const INITIAL = {
    company: "示例科技",
    title: "后端开发",
    job_id: 11,
    applied_at: todayIsoDate(),
  };

  it("恢复岗位草稿时把 JSON 日期还原成日期控件支持的值", async () => {
    writeDraft("tracker.edit#job-11", {
      ...INITIAL,
      applied_at: "2026-11-13T00:00:00.000Z",
      status_date: null,
      next_action_date: "2026-11-15",
    });
    render(
      <AntdApp>
        <TrackFormModal open track={null} initial={INITIAL} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("draft.restore.action") }));
    expect(screen.getByLabelText(t("trackerForm.field.appliedAt"))).toHaveValue("2026-11-13");
    expect(screen.getByLabelText(t("trackerForm.field.nextActionDate"))).toHaveValue("2026-11-15");
  });

  it("预填公司、岗位、日期与关联岗位，同时隔离通用新增草稿", async () => {
    writeDraft("tracker.edit#new", { company: "Unrelated draft", title: "Other job" });
    render(
      <AntdApp>
        <TrackFormModal open track={null} initial={INITIAL} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );
    expect(await screen.findByLabelText(t("trackerForm.field.company"))).toHaveValue(COMPANY);
    expect(screen.getByLabelText(t("trackerForm.field.title"))).toHaveValue(JOB_TITLE);
    expect(screen.getByLabelText(t("trackerForm.field.appliedAt"))).toHaveValue(todayIsoDate());
    expect(
      screen.queryByRole("button", { name: t("draft.restore.action") }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t("trackerForm.field.note")), {
      target: { value: "Job-specific note" },
    });
    await waitFor(() =>
      expect(readDraft("tracker.edit#job-11")?.values.note).toBe("Job-specific note"),
    );
    expect(readDraft("tracker.edit#new")?.values.company).toBe("Unrelated draft");
  });

  it("重复创建返回既有记录时切换编辑，继续保存使用更新接口", async () => {
    vi.mocked(createTrack).mockResolvedValue({ ...LISTED_ROW, created: false });
    vi.mocked(updateTrack).mockResolvedValue(LISTED_ROW);
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <AntdApp>
        <TrackFormModal open track={null} initial={INITIAL} onClose={onClose} onSaved={onSaved} />
      </AntdApp>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("trackerForm.action.save")) }),
    );
    expect(await screen.findByText(t("trackerForm.toast.existing"))).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: t("trackerForm.title.edit") })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    fireEvent.click(screen.getByRole("button", { name: /保存进度/ }));
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ company: LISTED_ROW.company }),
      ),
    );
    expect(createTrack).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("TrackFormModal 的投递日期", () => {
  it("说明留空的后果，而不是只写个格式", async () => {
    renderModal();

    expect(
      await screen.findByText(t("trackerForm.hint.appliedAt"), { exact: false }),
    ).toBeInTheDocument();
  });

  it("新增时不预填今天，日期栏保持空着", async () => {
    renderModal();

    // E12 起投递日期换成 DatePicker，用标签定位而不是占位文本。
    const input = await screen.findByLabelText(t("trackerForm.field.appliedAt"));
    // 预填今天会把"三周后照通知补录"的记录钉在错误的月份上。
    expect(input).toHaveValue("");
  });

  it("点「填今天」把本地当天日期填进去，用户仍可改", async () => {
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: t("trackerForm.action.fillToday") }));

    // 用本地日期而不是 UTC：晚上录的记录不该被写成"昨天"。
    await waitFor(() =>
      expect(screen.getByLabelText(t("trackerForm.field.appliedAt"))).toHaveValue(todayIsoDate()),
    );
  });

  it("编辑时从详情接口取全文回填——列表行的 note 是截断预览，不能拿它当编辑底稿", async () => {
    vi.mocked(getTrack).mockResolvedValue({ ...LISTED_ROW, note: "完整备注全文" });
    render(
      <AntdApp>
        <TrackFormModal open track={LISTED_ROW} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );

    // 详情请求回来后覆盖乐观预填的截断预览；保存（PUT 整体替换）以全文为准。
    await waitFor(() =>
      expect(screen.getByLabelText(t("trackerForm.field.note"))).toHaveValue(FULL_NOTE),
    );
    expect(getTrack).toHaveBeenCalledWith(7);
  });
});

/** 渠道与岗位关联（RF-18）：都选填，「未知」是渠道的合法默认值。 */
describe("TrackFormModal 的渠道与岗位选择", () => {
  it("渠道默认「未知」，且说明它与记录来源是两回事", async () => {
    renderModal();
    expect(await screen.findByLabelText(t("trackerForm.field.channel"))).toBeInTheDocument();
    expect(screen.getByText(t("trackerForm.hint.channel"), { exact: false })).toBeInTheDocument();
  });

  it("岗位关联选择器存在且选填（远程搜索，不再吃页面预拉的选项）", async () => {
    renderModal();
    expect(await screen.findByLabelText(t("trackerForm.field.job"))).toBeInTheDocument();
    // 打开表单即预拉第一页候选（P0-1）。
    await waitFor(() => expect(jobsMocks.listJobs).toHaveBeenCalled());
  });

  it("编辑时按 id 回查已关联的岗位（保显示）", async () => {
    vi.mocked(getTrack).mockResolvedValue({ ...LISTED_ROW, job_id: 11 });
    render(
      <AntdApp>
        <TrackFormModal open track={LISTED_ROW} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );

    // 详情请求回来后，按 id 回查的岗位以标题显示在选择器里。
    await waitFor(() =>
      expect(screen.getByText(`${JOB_TITLE} · ${COMPANY}`).closest(".ant-select")).toBeTruthy(),
    );
  });
});

/** 使用的简历选择器（RF-17）：选填，把进度显式关联到一版简历。 */
describe("TrackFormModal 的简历选择器", () => {
  it("选择器存在且选填（留空也能保存）", async () => {
    renderModal();
    expect(await screen.findByLabelText(t("trackerForm.field.resume"))).toBeInTheDocument();
    expect(screen.getByText(t("trackerForm.hint.resume"), { exact: false })).toBeInTheDocument();
  });

  it("编辑时按 id 回查已关联的简历版本（保显示）", async () => {
    vi.mocked(getTrack).mockResolvedValue({
      ...LISTED_ROW,
      resume_id: 3,
      resume_title: "后端岗位简历",
    });
    render(
      <AntdApp>
        <TrackFormModal open track={LISTED_ROW} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );

    // 按 id 回查的简历以标题显示在选择器里（选中项的展示文本）。
    await waitFor(() => expect(screen.getByText(RESUME_TITLE)).toBeInTheDocument());
  });
});
