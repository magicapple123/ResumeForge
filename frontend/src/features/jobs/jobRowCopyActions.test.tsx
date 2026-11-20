// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位行「复制」子菜单（2026-11-19，台账第 13 条）。
 *
 * 与简历侧共用 `components/common/copyMenu` 的机制，所以这里只钉**岗位特有的四点**：
 *
 * 1. 字段有内容才出现（城市 / 薪资 / 链接 / 备注为空时不摆空项）；
 * 2. 整行用 Tab 分隔，状态与来源取界面显示名，时间保留 ISO；
 * 3. JD 全文点下去才取详情（列表接口不带正文），且 `has_description === false` 时整项不出现；
 * 4. 取详情失败要说话，不能静默、也不能谎报"已复制"。
 */
import { describe, expect, it, vi } from "vitest";
import { COPY_TOAST_KEY } from "../../components/common/copyMenu";
import type { Job, JobList } from "../../types";
import { jobCopyFields, jobCopyMenu } from "./jobRowCopyActions";

const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock("../../utils/clipboard", () => clipboard);

const jobsApi = vi.hoisted(() => ({ getJob: vi.fn() }));
vi.mock("../../api/jobs", () => jobsApi);

const JOB: JobList = {
  id: 7,
  title: "高级后端工程师",
  company: "某某科技",
  location: "杭州",
  salary: "30-45K",
  job_type: "社招",
  requirements: "熟悉 Python。",
  additional_info: "",
  keywords: [],
  source: "手动添加",
  source_url: "https://example.com/jobs/7",
  posted_at: "2026-10-01",
  status: "开放中",
  note: "内推人：老王",
  note_images: [],
  recognition_source: "手动填写",
  origin_source: "",
  favorite: false,
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-22T09:30:00",
  has_description: true,
};

const DETAIL: Job = {
  ...JOB,
  description: "负责服务端架构设计与性能优化。",
};

function notifier() {
  return { success: vi.fn(), warning: vi.fn() };
}

function keys(job: JobList, loadJob?: (id: number) => Promise<Job>): string[] {
  return jobCopyFields(job, loadJob).map((field) => field.key);
}

/** 点一项并等到复制或告警落地。 */
async function click(key: string, job: JobList = JOB, loadJob?: (id: number) => Promise<Job>) {
  const notify = notifier();
  const field = jobCopyFields(job, loadJob).find((entry) => entry.key === key);
  expect(field).toBeDefined();
  const pending = field?.pick();
  const value = await pending;
  return { notify, field, value };
}

describe("岗位行「复制」子菜单", () => {
  it("字段齐全时给出七条 + 整行；空字段不占位置", () => {
    expect(keys(JOB)).toEqual([
      "copy_title",
      "copy_company",
      "copy_location",
      "copy_salary",
      "copy_url",
      "copy_note",
      "copy_jd",
      "copy_row",
    ]);
    // 只有标题有内容：仍给标题与整行（整行是排列表格用的，允许有空单元格）。
    expect(
      keys({
        ...JOB,
        company: " ",
        location: "",
        salary: "",
        source_url: "",
        note: "",
        has_description: false,
      }),
    ).toEqual(["copy_title", "copy_row"]);
  });

  it("整行用 Tab 分隔：状态与来源是界面显示名，时间保留 ISO", () => {
    const row = jobCopyFields(JOB).find((field) => field.key === "copy_row");
    expect(row?.pick()).toBe(
      [
        "高级后端工程师",
        "某某科技",
        "杭州",
        "30-45K",
        "开放中",
        "手动",
        "https://example.com/jobs/7",
        "2026-10-22T09:30:00",
      ].join("\t"),
    );
  });

  it("历史状态值 active 归一成「开放中」（与列表 Tag 同口径）", () => {
    const row = jobCopyFields({ ...JOB, status: "active" }).find(
      (field) => field.key === "copy_row",
    );
    expect((row?.pick() as string).split("\t")[4]).toBe("开放中");
  });

  it("JD 全文点下去才取详情（列表项不带正文）", async () => {
    const loadJob = vi.fn().mockResolvedValue(DETAIL);
    const { value } = await click("copy_jd", JOB, loadJob);
    expect(loadJob).toHaveBeenCalledWith(7);
    expect(value).toBe("负责服务端架构设计与性能优化。");
  });

  it("has_description=false 时整项不出现（不给点了才报错的入口）", () => {
    expect(keys({ ...JOB, has_description: false })).not.toContain("copy_jd");
  });

  it("取详情失败时给 JD 专用提示，不谎报成功", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(true);
    jobsApi.getJob.mockRejectedValueOnce(new Error("502"));
    const notify = notifier();
    // 走菜单项而不是直接调 pick：验证的是用户点下去之后的完整链路（默认走 getJob）。
    const menu = jobCopyMenu(JOB, notify);
    const item = menu.children?.find((entry) => entry.key === "copy_jd");
    expect(item).toBeDefined();
    item?.onClick?.();
    await vi.waitFor(() => expect(notify.warning).toHaveBeenCalled());
    expect(notify.warning).toHaveBeenCalledWith(
      expect.stringContaining("JD 没取到"),
      expect.objectContaining({ key: COPY_TOAST_KEY }),
    );
    expect(notify.success).not.toHaveBeenCalled();
    expect(clipboard.copyText).not.toHaveBeenCalled();
  });

  it("子菜单挂在「复制」下面，连点用同一个 message key 覆盖", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(true);
    const menu = jobCopyMenu(JOB, notifier());
    expect(menu.key).toBe("copy");
    expect(menu.label).toBe("复制");

    const notify = notifier();
    const built = jobCopyMenu(JOB, notify);
    const title = built.children?.find((entry) => entry.key === "copy_title");
    const company = built.children?.find((entry) => entry.key === "copy_company");
    title?.onClick?.();
    company?.onClick?.();
    await vi.waitFor(() => expect(notify.success).toHaveBeenCalledTimes(2));
    for (const call of notify.success.mock.calls) {
      expect(call[1]).toEqual({ key: COPY_TOAST_KEY });
    }
  });
});
