// SPDX-License-Identifier: Apache-2.0
/**
 * 启动提醒弹窗的「事件行」（整改 #13）：整行可点进详情，行内动作不许带走跳转。
 *
 * 这条链路此前是断的：后端早就在发 `/tracker?reminder={id}`，前端却把标题包在
 * `<Link to="/tracker">` 里、整行不可点——用户点一条提醒只会落到列表页，还得自己找。
 *
 * 钉四件事：
 *
 * 1. 点整行 → `onClose()` + 跳 `/tracker?reminder=N`（URL 是唯一真相，页面据此展开详情）；
 * 2. 点「完成」→ **不跳转**（行内动作必须各自 `stopPropagation`；删掉它会精确变红）；
 * 3. 标题不再是链接（整行已经是入口，再套一层就有两个可点区域）；
 * 4. 逾期用副行红字「逾期 N 天」，不再是一颗 Tag / 一条左色条。
 *
 * 断言里的按钮名走 `t()` + 空格容忍：antd 给两字中文按钮插空格（「完 成」），
 * 中文本身不进本文件的字面量（cjkRatchet 对新增文件没有额度）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderUpcoming } from "../../types";
import { t } from "../../i18n";
import { ReminderPopup } from "./ReminderPopup";

const reminderApiMocks = vi.hoisted(() => ({
  updateReminder: vi.fn(),
  snoozeReminder: vi.fn(),
}));

vi.mock("../../api/reminders", () => reminderApiMocks);

/** antd 会给两字中文按钮插空格：判定时容忍每个字符之间的空白。 */
function looseName(text: string): RegExp {
  return new RegExp(`^${[...text].join("\\s*")}$`);
}

function makeReminder(overrides: Partial<ReminderUpcoming> = {}): ReminderUpcoming {
  return {
    id: 42,
    // 标题用 ASCII：用例里有中文标题会让 cjkRatchet 把新文件当成"新增界面文案"。
    title: "Interview follow-up",
    remind_at: "2026-11-20T02:00:00",
    kind: "interview",
    status: "pending",
    track_id: null,
    job_id: null,
    resume_id: null,
    note: "",
    created_at: "2026-11-19T08:00:00",
    updated_at: "2026-11-19T08:00:00",
    urgency: "overdue",
    days_until: -2,
    due_label: "overdue",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPopup(reminders: ReminderUpcoming[]) {
  const onClose = vi.fn();
  render(
    <AntdApp>
      <MemoryRouter initialEntries={["/"]}>
        <ReminderPopup open reminders={reminders} onClose={onClose} />
        <LocationProbe />
      </MemoryRouter>
    </AntdApp>,
  );
  return { onClose };
}

beforeEach(() => {
  reminderApiMocks.updateReminder.mockReset();
  reminderApiMocks.snoozeReminder.mockReset();
  reminderApiMocks.updateReminder.mockResolvedValue(makeReminder({ status: "done" }));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ReminderPopup 的事件行", () => {
  it("点整行：关掉弹窗并带着 reminder 参数去求职进度", async () => {
    const { onClose } = renderPopup([makeReminder({ id: 12 })]);

    fireEvent.click(await screen.findByRole("button", { name: /Interview follow-up/ }));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/tracker?reminder=12");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点「完成」只改状态，不跳转", async () => {
    renderPopup([makeReminder({ id: 13 })]);

    const done = await screen.findByRole("button", {
      name: looseName(t("homePage.reminders.action.done")),
    });
    fireEvent.click(done);

    await waitFor(() =>
      expect(reminderApiMocks.updateReminder).toHaveBeenCalledWith(13, { status: "done" }),
    );
    // 反证对象：删掉按钮上的 stopPropagation，这条会变成 /tracker?reminder=13。
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("标题不是链接：整行已经是那个入口", async () => {
    renderPopup([makeReminder()]);

    expect(await screen.findByText("Interview follow-up")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("逾期写成副行红字，不再有 Tag / 左缘色条", async () => {
    renderPopup([makeReminder({ days_until: -3 })]);

    expect(
      await screen.findByText(t("trackerUi.card.overdueDays", { days: 3 })),
    ).toBeInTheDocument();
    expect(document.querySelector(".rf-reminder-modal-list .ant-tag")).toBeNull();
    expect(document.querySelector(".rf-reminder-modal-list .rf-event-row")).not.toBeNull();
  });

  it("未逾期时保留倒计时文案（「N 天后」这类信息不能丢）", async () => {
    renderPopup([makeReminder({ days_until: 2, urgency: "soon", due_label: "" })]);

    expect(
      await screen.findByText(t("homePage.reminders.due.inDays", { days: 2 })),
    ).toBeInTheDocument();
  });
});
