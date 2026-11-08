// SPDX-License-Identifier: Apache-2.0
/**
 * 日历提醒面板：列表渲染、完成/删除、详情抽屉、T05 新建弹层（默认未来时间、
 * 过去时间校验、关联折叠区、任务卡提示）、T06 逾期红标与时间范围筛选。
 */
import { App as AntApp } from "antd";
import dayjs from "dayjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { REMINDER_KIND_LABEL_KEYS, REMINDER_STATUS_LABEL_KEYS } from "../i18n/enum/reminder";
import ReminderPanel from "./ReminderPanel";

const apiMocks = vi.hoisted(() => ({
  listReminders: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
}));

vi.mock("../api/reminders", () => apiMocks);

const settingsMocks = vi.hoisted(() => ({ getAgentTaskEvents: vi.fn() }));
vi.mock("../api/settings", () => settingsMocks);

const selectMocks = vi.hoisted(() => ({
  track: { selectProps: {}, options: [], reload: vi.fn(), ensure: vi.fn() },
  job: { selectProps: {}, options: [], reload: vi.fn(), ensure: vi.fn() },
  resume: { selectProps: {}, options: [], reload: vi.fn(), ensure: vi.fn() },
}));

vi.mock("../hooks/remoteSearchOptions", () => ({
  useTrackSearchSelect: () => selectMocks.track,
  useJobSearchSelect: () => selectMocks.job,
  useResumeSearchSelect: () => selectMocks.resume,
}));

/** 列表条目名是**测试数据**（不是界面文案）；断言引用常量，避免新增中文字面量断言。 */
const ITEM_TITLE = "参加某司二面";
const OVERDUE_TITLE = "逾期待办";
const FUTURE_TITLE_PREFIX = "未来提醒";
const LOAD_FAILED = "读取提醒失败";

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "参加某司二面",
    remind_at: "2026-09-21T10:00:00",
    kind: "interview",
    status: "pending",
    track_id: null,
    job_id: null,
    resume_id: null,
    note: "",
    created_at: "2026-09-19T08:00:00",
    updated_at: "2026-09-19T08:00:00",
    ...overrides,
  };
}

const ITEMS = [makeItem()];

function renderPanel() {
  return render(
    <AntApp>
      {/* 关联目标下拉改为组件内部远程搜索（P0-1），不再从页面传选项。 */}
      <ReminderPanel />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.listReminders.mockReset().mockResolvedValue(ITEMS);
  apiMocks.updateReminder.mockReset().mockResolvedValue(undefined);
  apiMocks.deleteReminder.mockReset().mockResolvedValue(undefined);
  settingsMocks.getAgentTaskEvents.mockReset().mockResolvedValue({ enabled: true });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ReminderPanel", () => {
  it("渲染提醒列表，带类型与状态标签", async () => {
    renderPanel();

    expect(await screen.findByText(ITEM_TITLE)).toBeInTheDocument();
    expect(screen.getByText(t(REMINDER_KIND_LABEL_KEYS.interview))).toBeInTheDocument();
    expect(screen.getByText(t(REMINDER_STATUS_LABEL_KEYS.pending))).toBeInTheDocument();
    expect(apiMocks.listReminders).toHaveBeenCalled();
  });

  it("待办提醒可一键标记完成（PATCH status=done）", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    fireEvent.click(screen.getByRole("button", { name: /完成提醒 参加某司二面/ }));

    await waitFor(() =>
      expect(apiMocks.updateReminder).toHaveBeenCalledWith(1, { status: "done" }),
    );
  });

  it("删除先确认，确认后走软删除", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(apiMocks.deleteReminder).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText(t("reminderItem.action.delete")));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteReminder).toHaveBeenCalledWith(1));
  });

  it("读取失败时透出错误信息", async () => {
    apiMocks.listReminders.mockRejectedValue(new Error("读取提醒失败"));
    renderPanel();

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
  });

  it("点「详情」打开详情抽屉，看得到关联对象与备注", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    fireEvent.click(screen.getByRole("button", { name: "详情" }));

    expect(await screen.findByText(t("reminder.detail.track"))).toBeInTheDocument();
    expect(screen.getByText(t("reminder.detail.job"))).toBeInTheDocument();
    expect(screen.getByText(t("reminder.field.note"))).toBeInTheDocument();
  });

  it("批量删除的二次确认真的弹得出框（走 App.useApp().modal）", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    fireEvent.contextMenu(screen.getByText(ITEM_TITLE));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: new RegExp(t("reminder.selectMode")) }),
    );
    fireEvent.click(screen.getByText(ITEM_TITLE));
    fireEvent.click(screen.getByRole("button", { name: t("reminder.batch.delete") }));

    expect((await screen.findAllByText(t("reminder.confirm.deleteTitle"))).length).toBeGreaterThan(
      0,
    );
    expect(document.querySelector(".ant-modal-confirm")?.textContent).toContain(
      t("reminder.confirm.deleteBody", { count: 1 }),
    );
  });

  it("新建弹层默认是未来 1 小时（T05）", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("reminder.action.create")) }));

    const input = await waitFor(() => {
      const node = document.querySelector<HTMLInputElement>(".ant-picker input");
      expect(node).not.toBeNull();
      return node as HTMLInputElement;
    });
    const expected = dayjs().add(1, "hour").startOf("minute").format("YYYY-MM-DD HH:mm");
    const expectedNext = dayjs(expected, "YYYY-MM-DD HH:mm")
      .add(1, "minute")
      .format("YYYY-MM-DD HH:mm");
    expect([expected, expectedNext]).toContain(input.value);
    // 时间显示到分钟：不再带秒。
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("新建时选过去时间会被拦下，不会创建（T05）", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("reminder.action.create")) }));

    const input = document.querySelector<HTMLInputElement>(".ant-picker input");
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { value: "2020-01-01 10:00" } });
    fireEvent.keyDown(input as HTMLInputElement, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: t("reminder.modal.save") }));

    expect(await screen.findByText(t("reminder.required.futureTime"))).toBeInTheDocument();
    expect(apiMocks.createReminder).not.toHaveBeenCalled();
  });

  it("编辑时放行过去时间（只改备注不该被卡，T05）", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText(t("reminderItem.action.edit")));
    fireEvent.click(await screen.findByRole("button", { name: t("reminder.modal.save") }));

    await waitFor(() =>
      expect(apiMocks.updateReminder).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ remind_at: dayjs("2026-09-21T10:00:00").toISOString() }),
      ),
    );
  });

  it("关联字段收进折叠区：默认收起、标题旁显示已关联数量（T05）", async () => {
    apiMocks.listReminders.mockResolvedValue([makeItem({ track_id: 3, job_id: 7, resume_id: 9 })]);
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText(t("reminderItem.action.edit")));

    expect(
      await screen.findByText(t("reminder.field.linkedCount", { count: 3 })),
    ).toBeInTheDocument();
    // 默认收起：三个关联字段的 Form.Item 不渲染（展开后才挂载）。
    expect(screen.queryByText(t("reminder.field.job"))).toBeNull();
    fireEvent.click(screen.getByText(t("reminder.field.linkSection")));
    expect(await screen.findByText(t("reminder.field.job"))).toBeInTheDocument();
    expect(screen.getByText(t("reminder.field.resume"))).toBeInTheDocument();
  });

  it("时间字段下方按开关状态显示任务卡提示（T05）", async () => {
    settingsMocks.getAgentTaskEvents.mockResolvedValue({ enabled: false });
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("reminder.action.create")) }));
    expect(await screen.findByText(t("reminder.hint.taskCardOff"))).toBeInTheDocument();
    expect(screen.queryByText(t("reminder.hint.taskCardOn"))).toBeNull();
  });

  it("逾期 pending 显示「已逾期 N 天」红标，已完成的不显示（T06）", async () => {
    apiMocks.listReminders.mockResolvedValue([
      makeItem({ id: 1, title: "逾期待办", days_until: -1, urgency: "overdue" }),
      makeItem({
        id: 2,
        title: "已完成的历史",
        status: "done",
        days_until: -2,
        urgency: "overdue",
      }),
    ]);
    renderPanel();

    const tag = await screen.findByTestId("reminder-overdue-1");
    expect(tag.textContent).toBe(t("reminderItem.tag.overdue", { days: 1 }));
    expect(screen.queryByTestId("reminder-overdue-2")).toBeNull();
  });

  it("时间范围筛选「已逾期」只剩逾期项，且筛选后回到第 1 页（T06）", async () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      makeItem({ id: 20 + index, title: `未来提醒 ${index}`, days_until: 2, urgency: "upcoming" }),
    );
    apiMocks.listReminders.mockResolvedValue([
      makeItem({ id: 1, title: "逾期待办", days_until: -1, urgency: "overdue" }),
      ...many,
    ]);
    renderPanel();

    // 翻到第 2 页，再应用「已逾期」筛选：页码必须回到 1（否则逾期项在第 1 页看不到）。
    await screen.findByText(OVERDUE_TITLE);
    fireEvent.click(screen.getByTitle("2"));
    fireEvent.mouseDown(screen.getByLabelText(t("reminder.filter.range.placeholder")));
    fireEvent.click(await screen.findByTitle(t("reminder.filter.range.overdue")));

    await waitFor(() => expect(screen.getByText(OVERDUE_TITLE)).toBeInTheDocument());
    expect(screen.queryByText(`${FUTURE_TITLE_PREFIX} 10`)).toBeNull();
  });
});
