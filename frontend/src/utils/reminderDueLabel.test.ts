// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒倒计时胶囊的双语守卫。
 *
 * 四条分支（逾期 / 今天 / 明天 / N 天后）在两种语言下都要说人话，且：
 * 1. 中文必须与后端历史 `due_label` 逐字相同（否则同一颗胶囊换个位置就变了个说法）；
 * 2. 英文不得漏出中文——这正是用户截图里的缺陷；
 * 3. 旧后端没有 `days_until` 时回退 `due_label`，宁可露中文也不要空胶囊。
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyServerLocale, selectLocale } from "../i18n/localeStore";
import { reminderDueLabel } from "./reminderDueLabel";

afterEach(() => {
  // 复位到源语言：其它用例默认跑在 zh-CN 上。
  selectLocale("zh-CN");
});

describe("reminderDueLabel", () => {
  it("中文界面的四个分支与后端 due_label 逐字一致", () => {
    applyServerLocale("zh-CN");
    expect(reminderDueLabel(-2, "已逾期 2 天")).toBe("已逾期 2 天");
    expect(reminderDueLabel(0, "今天")).toBe("今天");
    expect(reminderDueLabel(1, "明天")).toBe("明天");
    expect(reminderDueLabel(3, "3 天后")).toBe("3 天后");
  });

  it("英文界面把四个分支都翻成英文（不残留中文）", () => {
    applyServerLocale("en-US");
    expect(reminderDueLabel(-2, "已逾期 2 天")).toBe("2d overdue");
    expect(reminderDueLabel(0, "今天")).toBe("Today");
    expect(reminderDueLabel(1, "明天")).toBe("Tomorrow");
    expect(reminderDueLabel(3, "3 天后")).toBe("In 3 days");
  });

  it("旧后端没有 days_until 时回退 due_label（不留空胶囊）", () => {
    applyServerLocale("en-US");
    expect(reminderDueLabel(undefined, "已逾期 2 天")).toBe("已逾期 2 天");
    expect(reminderDueLabel(null, "今天")).toBe("今天");
    // 非有限数同样按"拿不到结构化天数"处理，而不是渲染 "NaN 天后"。
    expect(reminderDueLabel(Number.NaN, "明天")).toBe("明天");
    expect(reminderDueLabel(Number.POSITIVE_INFINITY, "3 天后")).toBe("3 天后");
  });

  it("小数天数按截断处理，不渲染半天的文案", () => {
    applyServerLocale("zh-CN");
    expect(reminderDueLabel(2.7, "2 天后")).toBe("2 天后");
    // 不足一天且已逾期（-0.5 天）显示「今天」而不是「已逾期 0 天」。
    expect(reminderDueLabel(-0.5, "已逾期 1 天")).toBe("今天");
  });
});
