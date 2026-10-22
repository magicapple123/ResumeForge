// SPDX-License-Identifier: Apache-2.0
/** 日历提醒面板：列表渲染、标记完成、删除（软删）。 */
import { App as AntApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReminderPanel from "./ReminderPanel";

const apiMocks = vi.hoisted(() => ({
  listReminders: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
}));

vi.mock("../api/reminders", () => apiMocks);

const ITEMS = [
  {
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
  },
];

function renderPanel() {
  return render(
    <AntApp>
      {/* 绑定目标下拉已改为组件内部远程搜索（P0-1），不再从页面传选项。 */}
      <ReminderPanel />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.listReminders.mockReset().mockResolvedValue(ITEMS);
  apiMocks.updateReminder.mockReset().mockResolvedValue(undefined);
  apiMocks.deleteReminder.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ReminderPanel", () => {
  it("渲染提醒列表，带类型与状态标签", async () => {
    renderPanel();

    expect(await screen.findByText("参加某司二面")).toBeInTheDocument();
    expect(screen.getByText("面试")).toBeInTheDocument();
    expect(screen.getByText("待办")).toBeInTheDocument();
    expect(apiMocks.listReminders).toHaveBeenCalled();
  });

  it("待办提醒可一键标记完成（PATCH status=done）", async () => {
    renderPanel();
    await screen.findByText("参加某司二面");

    fireEvent.click(screen.getByRole("button", { name: /完成提醒 参加某司二面/ }));

    await waitFor(() =>
      expect(apiMocks.updateReminder).toHaveBeenCalledWith(1, { status: "done" }),
    );
  });

  it("删除先确认，确认后走软删除", async () => {
    renderPanel();
    await screen.findByText("参加某司二面");

    // 删除收进了「···」菜单：未确认前绝不能调用删除。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(apiMocks.deleteReminder).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("删除"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteReminder).toHaveBeenCalledWith(1));
  });

  it("读取失败时透出中文错误", async () => {
    apiMocks.listReminders.mockRejectedValue(new Error("读取提醒失败"));
    renderPanel();

    expect(await screen.findByText("读取提醒失败")).toBeInTheDocument();
  });

  it("点「详情」打开详情抽屉，看得到绑定对象与备注", async () => {
    renderPanel();
    await screen.findByText("参加某司二面");

    fireEvent.click(screen.getByRole("button", { name: "详情" }));

    expect(await screen.findByText("绑定漏斗")).toBeInTheDocument();
    expect(screen.getByText("绑定岗位")).toBeInTheDocument();
    expect(screen.getByText("备注")).toBeInTheDocument();
  });

  it("批量删除的二次确认真的弹得出框（走 App.useApp().modal，不是静态 Modal.confirm）", async () => {
    renderPanel();
    await screen.findByText("参加某司二面");

    // 批量选择入口在右键菜单里（R8 把工具栏按钮收进去了）。
    fireEvent.contextMenu(screen.getByText("参加某司二面"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
    // 多选模式下点整行即切换勾选（点勾选框会把行 onClick 一起触发出两次 toggle，
    // 见 ReminderListItem 的 selecting 分支——那是既有缺陷，不在本批修）。
    fireEvent.click(screen.getByText("参加某司二面"));
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));

    // modal.confirm 由 Provider 的 holder 渲染（比静态 confirm 多一个 tick，所以走 findBy）；
    // antd 会把标题同时渲染进内容区与可访问标签，因此按「至少出现一次」断言。
    expect((await screen.findAllByText("删除选中的提醒？")).length).toBeGreaterThan(0);
    // 条数按 §4.4 的例外移到正文（标题只写动作 + 对象，保证 ≤12 字）。
    // 用 textContent 而不是 getByText：断言的是"正文里有没有条数"，不是新增一处文案查询。
    expect(document.querySelector(".ant-modal-confirm")?.textContent).toContain(
      "这 1 条提醒会移入回收站",
    );
    expect(document.querySelector(".ant-modal-confirm")).not.toBeNull();
  });
});
