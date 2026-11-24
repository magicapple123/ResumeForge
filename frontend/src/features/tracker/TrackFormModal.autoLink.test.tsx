// SPDX-License-Identifier: Apache-2.0
/**
 * 进度表单的「关联链接自动带出」：选岗位时把岗位的投递链接补进链接字段。
 *
 * 规则只有一条，边界有三条——边界比规则更容易做错，且做错后**没人看得出来**：
 * 1. 链接已有内容就不覆盖（用户写的东西优先）；
 * 2. 清空岗位不动链接（取消关联 ≠ 清空地址）；
 * 3. 打开旧记录不自动补（PUT 是整体替换，补了就等于偷偷改历史数据）。
 *
 * 另外还有竞态：岗位详情是异步取的，用户连点两个岗位时，先发的请求可能后回来。
 * 防线是「请求序号 + 当前 job_id」双复核，两条都不要，迟到响应就会把旧岗位的链接
 * 写进表单。
 *
 * 与 `TrackFormModal.test.tsx` 分文件：那边验表单本身的字段与提交形态，
 * 这里只验这条异步规则，两处各自读得完。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { Track } from "../../types";
import { getTrack } from "../../api/tracker";
import TrackFormModal from "./TrackFormModal";

const COMPANY = "示例科技";
const JOB_TITLE = "后端开发";
/** 用户手填的地址：自动带出不该碰它。 */
const LINK_URL = "https://jobs.example.com/apply?utm_source=referral";
/** 两个岗位各自的投递链接（`Job.source_url`）。 */
const JOB_LINKS: Record<number, string> = {
  11: "https://jobs.example.com/11",
  12: "https://jobs.example.com/12",
};

const JOB_OPTIONS = [
  { id: 11, title: "后端开发", company: "示例科技" },
  { id: 12, title: "前端开发", company: "另一家" },
];

vi.mock("../../api/tracker", () => ({
  createTrack: vi.fn(),
  getTrack: vi.fn(),
  updateTrack: vi.fn(),
}));

// 岗位/简历下拉在组件内部远程搜索（P0-1）：取数与按 id 回查都走这两个 API 模块。
const jobsMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);

/** 列表行的形态：note/evidence 可能被后端截成预览（…结尾）。 */
const LISTED_ROW: Track = {
  id: 7,
  company: COMPANY,
  title: JOB_TITLE,
  status: "applied",
  stage_note: "",
  applied_at: "2026-09-18",
  status_date: "",
  next_action: "",
  next_action_date: "",
  note: "",
  evidence: "",
  job_id: null,
  resume_id: null,
  external_resume_id: null,
  channel: "unknown",
  resume_title: "",
  link: "",
  source: "manual",
  created_at: "2026-09-18T08:00:00",
  updated_at: "2026-09-18T08:00:00",
};

/** 岗位详情：自动带出只读 `source_url`，其余字段按列表项补齐即可。 */
function jobDetail(id: number): Record<string, unknown> {
  const base = JOB_OPTIONS.find((job) => job.id === id) ?? JOB_OPTIONS[0];
  return { ...base, source_url: JOB_LINKS[id] ?? "" };
}

/** 打开岗位下拉并点选某一项（antd v6 的展开热区是 `.ant-select-content`）。 */
async function pickJob(optionLabel: string): Promise<void> {
  const combobox = screen.getByLabelText(t("trackerForm.field.job"));
  const trigger = combobox.closest(".ant-select-content") ?? combobox;
  fireEvent.mouseDown(trigger);
  const option = await screen.findByText(optionLabel);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

/** 点岗位下拉的清除按钮（`allowClear`），等于"取消岗位关联"。 */
function clearJob(): void {
  const combobox = screen.getByLabelText(t("trackerForm.field.job"));
  const clear = combobox.closest(".ant-select")?.querySelector(".ant-select-clear");
  if (!clear) throw new Error("job select clear icon not found");
  fireEvent.mouseDown(clear);
  fireEvent.click(clear);
}

function renderModal() {
  return render(
    <AntdApp>
      <TrackFormModal open track={null} onClose={() => {}} onSaved={() => {}} />
    </AntdApp>,
  );
}

/** 链接输入框：自动带出的结果就落在这儿。 */
function linkInput(): HTMLElement {
  return screen.getByLabelText(t("trackerForm.field.link"));
}

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: JOB_OPTIONS, total: 2 });
  jobsMocks.getJob.mockReset().mockImplementation((id: number) => Promise.resolve(jobDetail(id)));
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  resumesMocks.getResume.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("TrackFormModal 的关联链接自动带出", () => {
  it("选了岗位、链接还空着 → 带上该岗位的投递链接", async () => {
    renderModal();

    await pickJob("后端开发 · 示例科技");

    await waitFor(() => expect(linkInput()).toHaveValue(JOB_LINKS[11]));
  });

  it("链接已有内容 → 不覆盖用户自己填的地址", async () => {
    renderModal();

    fireEvent.change(linkInput(), { target: { value: LINK_URL } });
    await pickJob("后端开发 · 示例科技");

    // 用户写下的地址是他自己的东西，选个岗位不该把它换掉。
    expect(linkInput()).toHaveValue(LINK_URL);
  });

  it("清空岗位不清链接", async () => {
    renderModal();

    await pickJob("后端开发 · 示例科技");
    await waitFor(() => expect(linkInput()).toHaveValue(JOB_LINKS[11]));

    clearJob();

    // 「取消岗位关联」是关联动作，不是清空链接动作。
    expect(linkInput()).toHaveValue(JOB_LINKS[11]);
  });

  it("编辑旧记录：打开表单不自动补链接", async () => {
    vi.mocked(getTrack).mockResolvedValue({ ...LISTED_ROW, job_id: 11, link: "" });
    render(
      <AntdApp>
        <TrackFormModal open track={LISTED_ROW} onClose={() => {}} onSaved={() => {}} />
      </AntdApp>,
    );

    await waitFor(() => expect(getTrack).toHaveBeenCalledWith(7));

    // 历史记录里没填就是没填：回填不等于补写（PUT 是整体替换，补了就写进库）。
    expect(linkInput()).toHaveValue("");
  });

  it("乱序：先选的岗位后返回，不覆盖后选岗位的链接", async () => {
    let resolveJob11: (job: unknown) => void = () => {};
    jobsMocks.getJob.mockImplementation((id: number) => {
      if (id === 11) {
        // 11 号岗位的详情故意挂起，等 12 号先回来之后再放行。
        return new Promise((resolve) => {
          resolveJob11 = resolve;
        });
      }
      return Promise.resolve(jobDetail(id));
    });
    renderModal();

    await pickJob("后端开发 · 示例科技");
    await pickJob("前端开发 · 另一家");
    await waitFor(() => expect(linkInput()).toHaveValue(JOB_LINKS[12]));

    await act(async () => {
      resolveJob11(jobDetail(11));
      await Promise.resolve();
    });

    // 序号已过期 + 表单里的 job_id 已经不是 11：两条复核都指向"丢弃这个响应"。
    expect(linkInput()).toHaveValue(JOB_LINKS[12]);
  });

  it("乱序：后选岗位没有投递链接时，也不能被先选岗位的迟到响应填上", async () => {
    let resolveJob11: (job: unknown) => void = () => {};
    jobsMocks.getJob.mockImplementation((id: number) => {
      if (id === 11) {
        return new Promise((resolve) => {
          resolveJob11 = resolve;
        });
      }
      // 12 号岗位自己没填投递链接：链接应当保持空着。
      return Promise.resolve({ ...jobDetail(id), source_url: "" });
    });
    renderModal();

    await pickJob("后端开发 · 示例科技");
    await pickJob("前端开发 · 另一家");

    await act(async () => {
      resolveJob11(jobDetail(11));
      await Promise.resolve();
    });

    // 这里不能靠"链接已有内容就不覆盖"那条兜底：链接本来就是空的，
    // 只有请求序号与当前 job_id 两道复核能挡住这条迟到的 11 号响应。
    expect(linkInput()).toHaveValue("");
  });
});
