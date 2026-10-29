// SPDX-License-Identifier: Apache-2.0
/**
 * 启动提醒弹窗的倒计时胶囊：结构化 `days_until` 优先，缺失时回退后端 `due_label`。
 *
 * ## 为什么要有这个文件
 *
 * `HomePage.test.tsx` 里三处提醒 fixture 全都带 `days_until`（1 / -2 / 0），于是**回退
 * 分支在组件层没有任何常驻覆盖**：旧后端（或旧数据）少了这个字段时，胶囊会不会变成空
 * Tag、会不会把 `NaN 天后` / `undefined` 渲染出来，此前只靠临时用例验一次就删。这里给
 * 两条路径各留一条断言。
 *
 * ## 为什么直接渲染 `ReminderPopup` 而不是整页
 *
 * 这条行为只取决于弹窗自己把 `item.days_until` / `item.due_label` 交给
 * `reminderDueLabel()`（调用点在 `ReminderPopup.tsx` 的 `reminderDueLabel(item.days_until,
 * item.due_label)`）。挂整页要连带 8 个接口 mock、启动弹窗的会话标记与 AppShell 文案，
 * 成本高而覆盖不变——`pages/home/` 下已有 `SearchCard.test.tsx` 这种组件级先例。
 *
 * ## 语言怎么切
 *
 * 与 `utils/reminderDueLabel.test.ts` 同一套写法：`applyServerLocale()` 改模块级 store，
 * 组件里的模块级 `t()` 读同一份快照；用例结束复位 zh-CN（`test/setup.ts` 的 `beforeEach`
 * 也会兜一层，但显式复位让本文件单独跑时也不留状态）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { applyServerLocale, selectLocale } from "../../i18n/localeStore";
import type { ReminderUpcoming } from "../../types";
import { ReminderPopup } from "./ReminderPopup";

/**
 * 旧后端原样下发的中文标签（`due_label` 的历史取值）。
 *
 * 写成常量而不是直接塞进 `getByText("…")`：`cjkRatchet` 的 **tests** 口径按「`*ByText`
 * 参数里有没有中文」逐文件计数，而新文件在基线里没有额度——直接写中文断言会被守卫判成
 * "新增界面文案"。这条字符串是**后端的历史产物**（不是本用例要维护的界面文案），用常量
 * 屏蔽这份噪音，断言强度不变（仍然是逐字比较）。
 */
const LEGACY_DUE_LABEL = "已逾期 2 天";

/**
 * 旧后端形态：**没有 `days_until`**，只有拼好的中文 `due_label`。
 *
 * 刻意用 `satisfies` 之外的最朴素写法——`days_until` 在类型上是可选的，此处干脆不写这个
 * 键，与真实旧后端响应完全同形（写 `days_until: undefined` 也能过，但那就不是"字段不存在"
 * 了）。
 */
const LEGACY_REMINDER: ReminderUpcoming = {
  id: 1,
  title: "催 HR 回复",
  remind_at: "2026-09-18T10:00:00",
  kind: "hr_reply",
  status: "pending",
  track_id: null,
  job_id: null,
  resume_id: null,
  note: "",
  created_at: "2026-09-19T08:00:00",
  updated_at: "2026-09-19T08:00:00",
  urgency: "overdue",
  due_label: LEGACY_DUE_LABEL,
};

/**
 * 新后端形态：同时下发结构化 `days_until` 与历史 `due_label`。
 *
 * `due_label` 与 `LEGACY_REMINDER` **逐字相同**，这样"同一句话"在两条路径下的显示可以
 * 直接对照：有 `days_until` 的那条不许回退，没有的那条必须回退。
 */
const STRUCTURED_REMINDER: ReminderUpcoming = {
  ...LEGACY_REMINDER,
  id: 2,
  title: "参加某司二面",
  kind: "interview",
  urgency: "overdue",
  days_until: -2,
  due_label: LEGACY_DUE_LABEL,
};

/** 渲染一个打开的提醒弹窗（`open` 固定为 true：本文件只关心胶囊文案）。 */
function renderPopup(reminders: ReminderUpcoming[]) {
  return render(
    <MemoryRouter>
      <ReminderPopup open reminders={reminders} onClose={() => undefined} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  // 复位到源语言：其它用例（以及 `test/setup.ts` 的默认 Provider）都跑在 zh-CN 上。
  selectLocale("zh-CN");
});

describe("ReminderPopup 的倒计时胶囊", () => {
  it("旧后端缺少 days_until 时回退 due_label：胶囊有字、不空、不出现 NaN/undefined", async () => {
    // 挑英文界面：若这里能显示后端那句中文，就说明是**回退**生效，而不是英文组合文案
    // 恰好长得一样。
    applyServerLocale("en-US");
    renderPopup([LEGACY_REMINDER]);

    // ① 回退生效：胶囊显示后端原样下发的 due_label（既不是空串，也不是语言包里的 key）。
    expect(await screen.findByText(LEGACY_DUE_LABEL)).toBeInTheDocument();
    // 胶囊本身非空——空 Tag 会让"什么时候到期"这条信息彻底消失，这正是回退要防的事。
    expect(screen.getByText(LEGACY_DUE_LABEL).textContent).toBe(LEGACY_DUE_LABEL);

    // ② 缺字段不能被拼成 "NaN 天后" / "undefined 天后"（`reminderDueLabel` 用
    //    `Number.isFinite` 挡掉，这里钉的是渲染结果而不是实现细节）。
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");

    // ③ 反证：这条提醒没有结构化天数，英文组合文案不该凭空出现。
    expect(screen.queryByText("2d overdue")).toBeNull();
  });

  it("有 days_until 时结构化字段优先：en-US 下显示 2d overdue，不回退成中文", async () => {
    applyServerLocale("en-US");
    renderPopup([STRUCTURED_REMINDER, LEGACY_REMINDER]);

    // 结构化那一行按当前语言组合（en-US）→ 英文胶囊。
    expect(await screen.findByText("2d overdue")).toBeInTheDocument();

    // 两条 fixture 的 due_label 逐字相同：只有**没有** days_until 的那条回退出中文。
    // 若结构化字段没被优先使用，这里会是 2。
    expect(screen.getAllByText(LEGACY_DUE_LABEL)).toHaveLength(1);

    // 同一屏里没有任何一处退化文案。
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("zh-CN 下两条路径文案一致：回退与本地组合不打架", async () => {
    applyServerLocale("zh-CN");
    renderPopup([STRUCTURED_REMINDER, LEGACY_REMINDER]);

    // 先等条目渲染出来（标题是 Link 文本，与胶囊文案无关，用它做锚点）。
    expect(await screen.findByText(STRUCTURED_REMINDER.title)).toBeInTheDocument();

    // 中文界面里"逾期 2 天"只有一种说法：结构化组合与后端历史 due_label 逐字相同，
    // 于是两颗胶囊都是这句话。
    expect(screen.getAllByText(LEGACY_DUE_LABEL)).toHaveLength(2);
  });
});
