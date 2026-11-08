// SPDX-License-Identifier: Apache-2.0
/**
 * 求职偏好卡（T14）：列表 / 空态 / 编辑 / 新增 / 删除撤销 / 撤销到上一版 / 409 稳定码提示。
 *
 * 文案断言一律走 t(...)（cjkRatchet 把测试里的中文 ByText 断言也算作待迁移文案）。
 * antd 会把恰好两个汉字的按钮排成「编 辑」，所以行内按钮统一用 data-testid 定位；
 * Toast 里的「撤销」按钮按文案取（它是 span，点击会冒泡到 button）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { JobPreference, JobPreferenceList } from "../../api/jobPreferences";
import { t } from "../../i18n";
import JobPreferenceCard from "./JobPreferenceCard";

const apiMocks = vi.hoisted(() => ({
  getJobPreferences: vi.fn(),
  createJobPreference: vi.fn(),
  updateJobPreference: vi.fn(),
  deleteJobPreference: vi.fn(),
  undoJobPreference: vi.fn(),
  restoreTrashItem: vi.fn(),
}));

vi.mock("../../api/jobPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/jobPreferences")>();
  return {
    ...actual,
    getJobPreferences: apiMocks.getJobPreferences,
    createJobPreference: apiMocks.createJobPreference,
    updateJobPreference: apiMocks.updateJobPreference,
    deleteJobPreference: apiMocks.deleteJobPreference,
    undoJobPreference: apiMocks.undoJobPreference,
  };
});
vi.mock("../../api/trash", () => ({ restoreTrashItem: apiMocks.restoreTrashItem }));

function preference(overrides: Partial<JobPreference> = {}): JobPreference {
  return {
    pref_id: "p1",
    kind: "available_from",
    label: "到岗时间",
    value_kind: "scalar",
    value: "2026-12-01",
    source: "user_stated",
    source_proposal_id: "proposal-1",
    note: "spoken note",
    state: "active",
    has_previous: true,
    created_at: "2026-11-09T00:00:00",
    updated_at: "2026-11-09T00:00:00",
    ...overrides,
  };
}

function listPayload(items: JobPreference[] = [preference()]): JobPreferenceList {
  return {
    items,
    catalog: [
      {
        kind: "available_from",
        value_kind: "scalar",
        label: "到岗时间",
        inject_priority: 8,
        options: [],
      },
      {
        kind: "session_note",
        value_kind: "scalar",
        label: "仅本次对话",
        inject_priority: 99,
        options: [],
      },
    ],
  };
}

function renderCard() {
  render(
    <AntdApp>
      <JobPreferenceCard />
    </AntdApp>,
  );
}

/** Toast 里的撤销按钮：文案是 span，点它会冒泡到真正的 button。 */
function clickToastUndo() {
  fireEvent.click(screen.getByText(t("toast.undo.label")));
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.getJobPreferences.mockResolvedValue(listPayload());
});

afterEach(() => cleanup());

describe("JobPreferenceCard 列表", () => {
  it("渲染 active 偏好：类别、值、来源；session_note 标「仅本次对话」", async () => {
    apiMocks.getJobPreferences.mockResolvedValue(
      listPayload([
        preference(),
        preference({
          pref_id: "p2",
          kind: "session_note",
          value: "temporary preference",
          has_previous: false,
          source: "user_edited",
        }),
      ]),
    );
    renderCard();
    const row = await screen.findByTestId("job-preference-p1");
    expect(within(row).getByText(t("jobPreference.kind.available_from"))).toBeTruthy();
    expect(
      within(row).getByText(t("jobPreference.value.fromDate", { date: "2026-12-01" })),
    ).toBeTruthy();
    expect(within(row).getByText(new RegExp(t("jobPreference.source.user_stated")))).toBeTruthy();
    const sessionRow = screen.getByTestId("job-preference-p2");
    expect(within(sessionRow).getByText(t("jobPreference.tag.sessionOnly"))).toBeTruthy();
  });

  it("一条都没有时给空态，并把新增动作内嵌在空态里", async () => {
    apiMocks.getJobPreferences.mockResolvedValue(listPayload([]));
    renderCard();
    expect(await screen.findByText(t("jobPreference.empty"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("jobPreference.action.add") })).toBeTruthy();
  });

  it("没有上一版时不显示「撤销到上一版」按钮", async () => {
    apiMocks.getJobPreferences.mockResolvedValue(
      listPayload([preference({ has_previous: false })]),
    );
    renderCard();
    const row = await screen.findByTestId("job-preference-p1");
    expect(within(row).queryByTestId("job-preference-undo-p1")).toBeNull();
  });

  it("读取失败时显示错误态与重试", async () => {
    apiMocks.getJobPreferences.mockRejectedValueOnce(new Error("boom"));
    renderCard();
    expect(await screen.findByRole("alert")).toBeTruthy();
    // antd 会把两字按钮排成「重 试」，用字符间可空白的正则匹配。
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("common.retry").split("").join("\\s*")),
      }),
    ).toBeTruthy();
  });
});

describe("JobPreferenceCard 写操作", () => {
  it("撤销到上一版调 undo 接口并重拉列表", async () => {
    apiMocks.undoJobPreference.mockResolvedValue(
      preference({ pref_id: "p0", value: "2026-11-01" }),
    );
    renderCard();
    await screen.findByTestId("job-preference-p1");
    fireEvent.click(screen.getByTestId("job-preference-undo-p1"));
    await waitFor(() => expect(apiMocks.undoJobPreference).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(apiMocks.getJobPreferences).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(t("jobPreference.toast.undone"))).toBeTruthy();
  });

  it("撤销返回 409 no_previous 时给「没有上一版」提示，不直接抛后端 detail", async () => {
    apiMocks.undoJobPreference.mockRejectedValue(
      new ApiError("没有上一版", 409, { businessCode: "no_previous" }),
    );
    renderCard();
    await screen.findByTestId("job-preference-p1");
    fireEvent.click(screen.getByTestId("job-preference-undo-p1"));
    expect(await screen.findByText(t("jobPreference.error.noPrevious"))).toBeTruthy();
  });

  it("编辑已有偏好：弹窗预填当前值，保存走 PATCH", async () => {
    apiMocks.updateJobPreference.mockResolvedValue(preference({ pref_id: "p9" }));
    renderCard();
    await screen.findByTestId("job-preference-p1");
    fireEvent.click(screen.getByTestId("job-preference-edit-p1"));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(t("jobPreference.form.value"));
    expect((input as HTMLInputElement).value).toBe("2026-12-01");
    fireEvent.change(input, { target: { value: "2026-12-15" } });
    fireEvent.click(screen.getByRole("button", { name: t("jobPreference.form.save") }));
    await waitFor(() =>
      expect(apiMocks.updateJobPreference).toHaveBeenCalledWith("p1", {
        value: "2026-12-15",
        note: "spoken note",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("新增偏好：填值后 POST，成功后关闭弹窗并重拉", async () => {
    apiMocks.createJobPreference.mockResolvedValue(preference({ pref_id: "p3" }));
    renderCard();
    await screen.findByTestId("job-preference-p1");
    fireEvent.click(screen.getByTestId("job-preference-add"));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(t("jobPreference.form.value"));
    fireEvent.change(input, { target: { value: "2027-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: t("jobPreference.form.save") }));
    await waitFor(() =>
      expect(apiMocks.createJobPreference).toHaveBeenCalledWith({
        kind: "available_from",
        value: "2027-01-01",
        note: "",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("删除后给 5 秒撤销；点撤销按回收站行 id 恢复", async () => {
    apiMocks.deleteJobPreference.mockResolvedValue({ pref_id: "p1", id: 123, deleted: true });
    apiMocks.restoreTrashItem.mockResolvedValue(undefined);
    renderCard();
    await screen.findByTestId("job-preference-p1");
    fireEvent.click(screen.getByTestId("job-preference-delete-p1"));
    await waitFor(() => expect(apiMocks.deleteJobPreference).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText(t("jobPreference.toast.deleted"))).toBeTruthy();
    clickToastUndo();
    await waitFor(() =>
      expect(apiMocks.restoreTrashItem).toHaveBeenCalledWith("job_preference", 123),
    );
  });

  it("删除响应没有回收站行 id 时退化为「可在回收站恢复」提示，不伪造撤销入口", async () => {
    apiMocks.deleteJobPreference.mockResolvedValue({ pref_id: "p1", deleted: true });
    renderCard();
    await screen.findByTestId("job-preference-p1");
    fireEvent.click(screen.getByTestId("job-preference-delete-p1"));
    expect(await screen.findByText(t("jobPreference.toast.deletedTrash"))).toBeTruthy();
    expect(screen.queryByText(t("toast.undo.label"))).toBeNull();
  });
});
