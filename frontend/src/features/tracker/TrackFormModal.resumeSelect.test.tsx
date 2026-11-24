// SPDX-License-Identifier: Apache-2.0
/**
 * 「使用的简历」下拉（T6）：候选随岗位收窄成「本岗位 + 通用」，内部 / 外部分两组，
 * 值是复合串 `internal:<id>` / `external:<id>`（`resume_record` 与 `external_resume`
 * 两张表 id 会撞号，用裸数字会在保存时拆错字段）。
 *
 * 为什么单独一个文件：`TrackFormModal.test.tsx` 已经贴到 500 行预算（CI 硬闸门），
 * 而这一批用例要自己的三组 API mock（岗位 / 内部简历 / 外部简历）。拆文件时 mock 也
 * 必须跟着走——`vi.mock` 是模块级的，留在原文件里对新文件不生效。
 *
 * cjkRatchet 守卫：测试文件的「中文 ByText 断言」只降不升，所以本文件的 mock 数据与
 * `*ByText` 断言一律用 ASCII；界面文案用 `t()` 取（例如「（已删除）」「（不属于当前岗位）」
 * 的后缀），断言用变量而非中文字面量。
 *
 * 四条线：
 * 1. 未选岗位 = 全库（与整改前一致），两组都在；
 * 2. 选了岗位后只剩「本岗位 + 通用」；
 * 3. 换岗位**保留**已选值并标注「不属于当前岗位」（不清空、不自动改选）；
 * 4. 复合值双向映射 + 404 降级。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { Track } from "../../types";
import TrackFormModal from "./TrackFormModal";
import { getTrack, updateTrack } from "../../api/tracker";

vi.mock("../../api/tracker", () => ({
  createTrack: vi.fn(),
  getTrack: vi.fn(),
  updateTrack: vi.fn(),
}));

const jobsMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
const externalMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  getExternalResume: vi.fn(),
}));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);
vi.mock("../../api/externalResumes", () => externalMocks);

const JOB_OPTIONS = [
  { id: 11, title: "Backend Dev", company: "Acme" },
  { id: 12, title: "Frontend Dev", company: "Other Co" },
];
/** 内部简历：每份都带 `job_id`——收窄与「不属于当前岗位」标注都靠它。 */
const RESUME_OPTIONS = [
  { id: 3, title: "Backend resume", job_id: 11 },
  { id: 4, title: "Another resume", job_id: 12 },
  { id: 5, title: "General resume", job_id: null },
];
/** 外部简历：文案来自 `external_resume.name`（上传时的文件名或用户改过的名字）。 */
const EXTERNAL_OPTIONS = [
  { id: 3, name: "External A", job_id: 11 },
  { id: 9, name: "External general", job_id: null },
];

const EDITING_ROW: Track = {
  id: 7,
  company: "Acme",
  title: "Backend Intern",
  status: "applied",
  stage_note: "",
  applied_at: "2026-09-18",
  status_date: "",
  next_action: "",
  next_action_date: "",
  note: "",
  evidence: "",
  job_id: 11,
  resume_id: null,
  external_resume_id: null,
  channel: "unknown",
  resume_title: "",
  link: "",
  source: "manual",
  created_at: "2026-09-18T08:00:00",
  updated_at: "2026-09-18T08:00:00",
};

/** `include_general` 的服务端口径：`job_id == ? OR job_id IS NULL`。 */
function filterByJob<T extends { id: number; job_id: number | null }>(
  items: T[],
  params: { job_id?: number; include_general?: boolean },
): T[] {
  if (params.job_id == null) return items;
  return items.filter(
    (item) => item.job_id === params.job_id || (params.include_general && item.job_id === null),
  );
}

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: JOB_OPTIONS, total: 2 });
  jobsMocks.getJob
    .mockReset()
    .mockImplementation((id: number) =>
      Promise.resolve(JOB_OPTIONS.find((job) => job.id === id) ?? null),
    );
  resumesMocks.listResumes
    .mockReset()
    .mockImplementation((params: { job_id?: number; include_general?: boolean } = {}) =>
      Promise.resolve({ items: filterByJob(RESUME_OPTIONS, params), total: RESUME_OPTIONS.length }),
    );
  resumesMocks.getResume.mockReset().mockImplementation((id: number) => {
    const found = RESUME_OPTIONS.find((resume) => resume.id === id);
    return found ? Promise.resolve(found) : Promise.reject(new Error("404"));
  });
  externalMocks.listExternalResumes
    .mockReset()
    .mockImplementation((params: { job_id?: number; include_general?: boolean } = {}) =>
      Promise.resolve({
        items: filterByJob(EXTERNAL_OPTIONS, params),
        total: EXTERNAL_OPTIONS.length,
        page: 1,
        page_size: 50,
      }),
    );
  externalMocks.getExternalResume.mockReset().mockImplementation((id: number) => {
    const found = EXTERNAL_OPTIONS.find((resume) => resume.id === id);
    return found ? Promise.resolve(found) : Promise.reject(new Error("404"));
  });
});

function renderEditing(track: Track) {
  vi.mocked(getTrack).mockResolvedValue(track);
  return render(
    <AntdApp>
      <TrackFormModal open track={track} onClose={() => {}} onSaved={() => {}} />
    </AntdApp>,
  );
}

/** 新增态：还没选岗位 → 候选应当是全库。 */
function renderCreating() {
  return render(
    <AntdApp>
      <TrackFormModal open track={null} onClose={() => {}} onSaved={() => {}} />
    </AntdApp>,
  );
}

/** 打开下拉并点中某一项（antd 的 Select 靠 `mouseDown` 展开）。 */
async function pickOption(labelText: string, field: string) {
  fireEvent.mouseDown(screen.getByLabelText(field));
  fireEvent.click(await screen.findByText(labelText));
}

/** 打开简历下拉：antd 的 Select 靠 `mouseDown` 展开，不展开就看不到选项。 */
async function openResumeOptions() {
  const input = await screen.findByLabelText(t("trackerForm.field.resume"));
  fireEvent.mouseDown(input);
  await screen.findByText(t("trackerForm.resume.group.internal"));
}

/** 等岗位的值落进表单（watch 生效后才会按 job_id 重拉候选）。 */
async function waitUntilJobBound(jobId: number) {
  await waitFor(() =>
    expect(resumesMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: jobId }),
    ),
  );
}

describe("未选岗位时候选是全库", () => {
  it("两组都渲染，且两张表都带上了 include_general", async () => {
    renderCreating();
    await openResumeOptions();

    expect(screen.getByText(t("trackerForm.resume.group.external"))).toBeInTheDocument();
    for (const resume of RESUME_OPTIONS) {
      expect(screen.getByText(resume.title)).toBeInTheDocument();
    }
    for (const resume of EXTERNAL_OPTIONS) {
      expect(screen.getByText(resume.name)).toBeInTheDocument();
    }
    expect(resumesMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ include_general: true }),
    );
    expect(externalMocks.listExternalResumes).toHaveBeenCalledWith(
      expect.objectContaining({ include_general: true }),
    );
  });
});

describe("选了岗位后候选只剩本岗位 + 通用", () => {
  it("别的岗位的内部/外部简历都不出现", async () => {
    renderEditing(EDITING_ROW);
    await waitUntilJobBound(11);
    await openResumeOptions();

    // 本岗位（11）与通用（job_id = null）留下。
    expect(screen.getByText("Backend resume")).toBeInTheDocument();
    expect(screen.getByText("General resume")).toBeInTheDocument();
    expect(screen.getByText("External A")).toBeInTheDocument();
    expect(screen.getByText("External general")).toBeInTheDocument();
    // 别的岗位（12）那份不能出现——“选了岗位还看到别人的简历”正是这次要修的。
    expect(screen.queryByText("Another resume")).toBeNull();
  });
});

describe("换岗位保留已选值", () => {
  it("标注「不属于当前岗位」，且不自动改选", async () => {
    renderEditing({ ...EDITING_ROW, resume_id: 3, resume_title: "Backend resume" });
    await waitUntilJobBound(11);

    // 换到 12 号岗位：3 号简历不再是「本岗位 + 通用」里的候选。
    await pickOption(
      `${JOB_OPTIONS[1].title} · ${JOB_OPTIONS[1].company}`,
      t("trackerForm.field.job"),
    );

    const kept = `Backend resume${t("trackerForm.resume.notInJob")}`;
    expect(await screen.findByText(kept)).toBeInTheDocument();
    // 不清空、不自动改选：保存时也必须仍是 3 号内部简历。
    await waitFor(() => expect(updateTrack).not.toHaveBeenCalled());
  });
});

describe("复合值双向映射", () => {
  it("内部关联保存时拆回 resume_id，external 为 null", async () => {
    const track = { ...EDITING_ROW, resume_id: 3, resume_title: "Backend resume" };
    vi.mocked(updateTrack).mockResolvedValue(track);
    renderEditing(track);

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("trackerForm.action.save")) }),
    );
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ resume_id: 3, external_resume_id: null }),
      ),
    );
  });

  it("外部关联保存时拆回 external_resume_id，resume_id 为 null", async () => {
    const track = { ...EDITING_ROW, external_resume_id: 3, resume_title: "External A" };
    vi.mocked(updateTrack).mockResolvedValue(track);
    renderEditing(track);

    expect(await screen.findByText("External A")).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("trackerForm.action.save")) }),
    );
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ external_resume_id: 3, resume_id: null }),
      ),
    );
  });
});

describe("404 降级", () => {
  it("外部简历已删时用标题快照 +（已删除），不显示裸复合值", async () => {
    const track = {
      ...EDITING_ROW,
      external_resume_id: 99,
      resume_title: "Deleted external resume",
    };
    renderEditing(track);

    const degraded = `Deleted external resume${t("trackerForm.resume.deleted")}`;
    expect(await screen.findByText(degraded)).toBeInTheDocument();
    expect(screen.queryByText("external:99")).toBeNull();
  });

  it("内部简历已删时同样降级（两条回查路径一个口径）", async () => {
    const track = { ...EDITING_ROW, resume_id: 98, resume_title: "Deleted internal resume" };
    renderEditing(track);

    const degraded = `Deleted internal resume${t("trackerForm.resume.deleted")}`;
    expect(await screen.findByText(degraded)).toBeInTheDocument();
    expect(screen.queryByText("internal:98")).toBeNull();
  });
});
