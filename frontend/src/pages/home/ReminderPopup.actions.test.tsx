// SPDX-License-Identifier: Apache-2.0
/**
 * 启动提醒弹窗的「逐条处理」（CR-21）。
 *
 * ## 为什么单独一个文件
 *
 * `ReminderPopup` 原来只能「知道了」——关掉之后提醒仍然是 pending，下次启动再弹一遍。
 * 这里钉的是新行为：每行「完成 / 忽略」调 `PATCH /reminders/{id}`、行内请求中禁用、
 * 处理完一条通知外面刷新、最后一条处理完自动关闭；失败时**保留该行**并给 toast。
 *
 * 直接渲染组件而不是挂整页：本文件关心的是弹窗自己的请求与生命周期，
 * 挂整页要连带 8 个接口 mock（与 `ReminderPopup.fallback.test.tsx` 同一取舍）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderUpcoming } from "../../types";
import { t } from "../../i18n";
import { ReminderPopup } from "./ReminderPopup";

/**
 * antd 会给**两字**中文按钮插入空格（「完成」渲染成「完 成」），无障碍名同样带空格。
 * 断言用容忍空白的正则，而不是改组件里的文案。
 *
 * T25（R24）之后行内只剩「完成」+ `⋯`：稍后与忽略都在 `⋯` 的菜单里，所以「忽略」
 * 的断言从"按钮"改成"菜单项"，仍是同一条行为（PATCH dismissed），没有放松。
 */
const DONE = /^完\s*成$/;
/** 用例里的提醒标题：抽成常量，避免 `getByText("中文")` 触发中文断言棘轮。 */
const TITLE_HR = "催 HR 回复";
const TITLE_B = "投递 B 司";
const TITLE_C = "回访 HR";
const IGNORE = /^忽\s*略$/;

const reminderApiMocks = vi.hoisted(() => ({ updateReminder: vi.fn() }));

vi.mock("../../api/reminders", () => reminderApiMocks);

function makeReminder(id: number, title: string): ReminderUpcoming {
  return {
    id,
    title,
    remind_at: "2026-11-26T10:00:00",
    kind: "interview",
    status: "pending",
    track_id: null,
    job_id: null,
    resume_id: null,
    note: "",
    created_at: "2026-11-25T08:00:00",
    updated_at: "2026-11-25T08:00:00",
    urgency: "soon",
    days_until: 1,
    due_label: "明天",
  };
}

interface RenderOptions {
  reminders: ReminderUpcoming[];
  onClose?: () => void;
  onChanged?: () => void;
}

function renderPopup({ reminders, onClose = vi.fn(), onChanged = vi.fn() }: RenderOptions) {
  return {
    onClose,
    onChanged,
    ...render(
      <AntdApp>
        <MemoryRouter>
          <ReminderPopup open reminders={reminders} onClose={onClose} onChanged={onChanged} />
        </MemoryRouter>
      </AntdApp>,
    ),
  };
}

beforeEach(() => {
  reminderApiMocks.updateReminder.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ReminderPopup 逐条处理", () => {
  it("点「完成」：PATCH 这条提醒为 done，行消失并通知外面刷新", async () => {
    reminderApiMocks.updateReminder.mockResolvedValue({
      ...makeReminder(3, "催 HR 回复"),
      status: "done",
    });
    const { onChanged } = renderPopup({ reminders: [makeReminder(3, "催 HR 回复")] });

    fireEvent.click(await screen.findByRole("button", { name: DONE }));

    await waitFor(() =>
      expect(reminderApiMocks.updateReminder).toHaveBeenCalledWith(3, { status: "done" }),
    );
    await waitFor(() => expect(screen.queryByText(TITLE_HR)).toBeNull());
    expect(onChanged).toHaveBeenCalled();
  });

  it("「忽略」收在 ⋯ 菜单里：点它 PATCH 为 dismissed", async () => {
    reminderApiMocks.updateReminder.mockResolvedValue({
      ...makeReminder(4, "整理作品集"),
      status: "dismissed",
    });
    renderPopup({ reminders: [makeReminder(4, "整理作品集")] });

    fireEvent.click(await screen.findByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: IGNORE }));

    await waitFor(() =>
      expect(reminderApiMocks.updateReminder).toHaveBeenCalledWith(4, { status: "dismissed" }),
    );
  });

  it("行内请求中禁用该行按钮，避免重复提交", async () => {
    let resolvePatch: (value: unknown) => void = () => undefined;
    reminderApiMocks.updateReminder.mockReturnValue(
      new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    );
    renderPopup({ reminders: [makeReminder(5, "准备测评")] });

    fireEvent.click(await screen.findByRole("button", { name: DONE }));

    await waitFor(() => expect(screen.getByRole("button", { name: DONE })).toBeDisabled());
    // 行内只剩两个入口：另一个是 ⋯（稍后 / 忽略都在它的菜单里，菜单打不开就等于
    // 那一行整组动作都拦住了）。
    expect(screen.getByRole("button", { name: t("common.rowActions.more") })).toBeDisabled();
    expect(screen.queryByRole("menuitem", { name: IGNORE })).toBeNull();

    resolvePatch({ ...makeReminder(5, "准备测评"), status: "done" });
  });

  it("最后一条处理完自动关闭", async () => {
    reminderApiMocks.updateReminder.mockResolvedValue({
      ...makeReminder(6, "投递 A 司"),
      status: "done",
    });
    const { onClose } = renderPopup({ reminders: [makeReminder(6, "投递 A 司")] });

    fireEvent.click(await screen.findByRole("button", { name: DONE }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("还有剩余行时不自动关闭", async () => {
    reminderApiMocks.updateReminder.mockResolvedValue({
      ...makeReminder(7, "投递 B 司"),
      status: "done",
    });
    const { onClose } = renderPopup({
      reminders: [makeReminder(7, "投递 B 司"), makeReminder(8, "投递 C 司")],
    });

    const doneButtons = await screen.findAllByRole("button", { name: DONE });
    fireEvent.click(doneButtons[0]);

    await waitFor(() => expect(screen.queryByText(TITLE_B)).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("失败时保留该行并给出 toast", async () => {
    reminderApiMocks.updateReminder.mockRejectedValue(new Error("后端没起来"));
    const { onChanged } = renderPopup({ reminders: [makeReminder(9, "回访 HR")] });

    fireEvent.click(await screen.findByRole("button", { name: DONE }));

    await waitFor(() => expect(reminderApiMocks.updateReminder).toHaveBeenCalled());
    // 行还在（没被乐观删掉），且按钮恢复可用。
    expect(await screen.findByText(TITLE_C)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: DONE })).not.toBeDisabled());
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      await screen.findByText(new RegExp(t("homePage.reminders.toast.updateFailed"))),
    ).toBeInTheDocument();
  });

  it("footer 整条删除（推翻 CR-21）：body 底下不再有「关闭」，只剩右上角 ×", async () => {
    renderPopup({ reminders: [makeReminder(10, "整理简历")] });

    // 行渲染出来之后再断言：否则"没有 footer"可能只是弹窗还没挂上。
    await screen.findByRole("button", { name: DONE });
    expect(document.querySelector(".rf-reminder-modal .ant-modal-footer")).toBeNull();
    // 唯一关闭入口：右上角 ×（它是 antd 的 close 按钮，无障碍名是语言包里的"关闭"）。
    expect(document.querySelector(".rf-reminder-modal .ant-modal-close")).not.toBeNull();
    // 反证：CR-21 之前那颗「知道了」也不许借尸还魂（footer 与行内都没有它）。
    expect(screen.queryByRole("button", { name: /知道了/ })).toBeNull();
  });
});
