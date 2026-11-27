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
 *
 * T25（R24）补两块：
 *
 * 5. 行内只留「完成」+ `⋯`——稍后与忽略在同一个菜单里（预设仍来自 ReminderSnoozeMenu）；
 * 6. 皮肤守卫：Listy 的 16px 横向内边距归零 + footer 删除后的 22px 底部留白 + `⋯` 的
 *    二级灰。这三条是"三条右缘重合"在源码里的唯一依据（jsdom 不加载这份 CSS）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderUpcoming } from "../../types";
import { t } from "../../i18n";
import { ReminderPopup } from "./ReminderPopup";

// 与 EventRow.test.tsx / styles/*.test.ts 同一读法：以 cwd 为根拼绝对路径。
declare const process: { cwd(): string };
const RAW_CSS = readFileSync(`${process.cwd()}/src/pages/home/reminderPopupSurface.css`, "utf8");

/** 去掉注释再断言：注释里写着"这里归零了"本身不算实现。 */
const POPUP_CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

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

/**
 * T25（R24）：三个同层动作收成一个主按钮 + 一个 `⋯`。
 *
 * 钉的是"菜单里到底有什么"——只删掉两个按钮、没把它们放进菜单，等于把功能弄丢。
 */
describe("ReminderPopup 的行内动作收敛", () => {
  it("行内只剩两个按钮：⋯ 与「完成」；稍后不再是行内文字按钮", async () => {
    renderPopup([makeReminder({ id: 31 })]);

    const actions = document.querySelector(".rf-reminder-modal-list .rf-event-actions");
    expect(actions).not.toBeNull();
    expect(actions?.querySelectorAll("button")).toHaveLength(2);
    // 「稍后」原先是一颗带时钟图标的文字按钮，现在只在菜单里出现。
    expect(screen.queryByRole("button", { name: t("reminder.snooze.action") })).toBeNull();
    expect(
      await screen.findByRole("button", { name: t("common.rowActions.more") }),
    ).toBeInTheDocument();
  });

  it("⋯ 的菜单里同时有稍后（预设 + 自定义）与忽略——同一份 ReminderSnoozeMenu", async () => {
    renderPopup([makeReminder({ id: 32 })]);

    fireEvent.click(await screen.findByRole("button", { name: t("common.rowActions.more") }));

    // 预设来自共用菜单：这里断言三个预设 + 自定义入口都在，而不是只断言"有个下拉"。
    expect(
      await screen.findByRole("menuitem", { name: t("reminder.snooze.oneHour") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: t("reminder.snooze.tonight") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: t("reminder.snooze.tomorrowMorning") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("reminder.snooze.custom") })).toBeInTheDocument();
    // 忽略也在这份菜单里（通过 extraItems 追加，没有第二个下拉）。
    expect(
      screen.getByRole("menuitem", { name: t("homePage.reminders.action.ignore") }),
    ).toBeInTheDocument();
  });
});

/**
 * 皮肤守卫：jsdom 不加载 `reminderPopupSurface.css`，所以"三条右缘重合"在单测里
 * 只能落到"那两条把内边距归零的规则确实写着"。像素级证据由 `shots/T25/` 的探针给。
 */
describe("ReminderPopup 皮肤的右缘守卫（T25）", () => {
  it("Listy 的 16px 横向内边距与行的 4px 都归零：三条右缘才可能落在同一条线", () => {
    expect(POPUP_CSS).toMatch(/\.ant-listy-item\s*\{[^}]*padding-inline:\s*0/);
    expect(POPUP_CSS).toMatch(/\.rf-event-row\s*\{[^}]*padding:\s*0/);
  });

  it("footer 删除后卡片底部留白 22px（antd v6 落在 .ant-modal-container 上）", () => {
    expect(POPUP_CSS).toMatch(/\.ant-modal-container\s*\{[^}]*padding-bottom:\s*22px/);
    // 反证：不许再往 `.ant-modal-body` 写 padding —— antd v6 的 body 自己是 0，
    // 那条规则在特异性上输给 antd（实测 computed 0px），写了也只是一段死代码。
    expect(POPUP_CSS).not.toMatch(/\.ant-modal-body\s*\{[^}]*padding/);
  });

  it("⋯ 用二级灰（三级灰在 460px 的卡里看不见）", () => {
    expect(POPUP_CSS).toMatch(/\.rf-event-actions\s+\.ant-btn[^{]*\{[^}]*--rf-text-secondary/);
  });
});
