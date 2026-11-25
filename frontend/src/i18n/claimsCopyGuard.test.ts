// SPDX-License-Identifier: Apache-2.0
/**
 * CR-35 文案守卫：主张（claim）相关的提示**不得承诺"拦截/进不了简历"**。
 *
 * 为什么：导出链路只做**提醒**（`resume_health` 统计待确认主张、`resume_risk_outbound`
 * 只看"不采用"），并没有按 `待确认` 过滤或阻断。文案说"会被拦下""不会进简历"，承诺了
 * 实现里不存在的强制力——用户据此以为不核实也没风险，反而更危险。
 *
 * 口径：只说"会在导出前提示你核对"。
 */
import { describe, expect, it } from "vitest";
import enUS from "./messages/en-US";
import zhCN from "./messages/zh-CN";

const KEYS = [
  "pagesMisc.homePage.todo.claims.hint",
  "activationUi.deliver.cta.hintPending",
] as const;

const ZH_FORBIDDEN = ["拦下", "不会进简历", "不能进正式简历"];
const EN_FORBIDDEN = ["cannot enter", "stops on them", "never make it"];

const read = (pack: unknown, key: string): string => {
  const value = (pack as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

describe("CR-35 主张提示不承诺拦截", () => {
  it.each(KEYS)("中文键存在且不承诺拦截：%s", (key) => {
    const value = read(zhCN, key);
    expect(value, `${key} 不应为空`).not.toBe("");
    for (const word of ZH_FORBIDDEN) {
      expect(value, `${key} 出现了「${word}」`).not.toContain(word);
    }
  });

  it.each(KEYS)("英文键存在且不承诺拦截：%s", (key) => {
    const value = read(enUS, key).toLowerCase();
    expect(value, `${key} 不应为空`).not.toBe("");
    for (const word of EN_FORBIDDEN) {
      expect(value, `${key} 出现了「${word}」`).not.toContain(word);
    }
  });
});
