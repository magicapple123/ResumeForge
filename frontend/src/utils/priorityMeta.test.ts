// SPDX-License-Identifier: Apache-2.0
/** 三档优先级的共享映射：颜色固定、labelKey 透传，少一个 key 就是编译错误。 */
import { describe, expect, it } from "vitest";
import { priorityMeta } from "./priorityMeta";

describe("priorityMeta", () => {
  it("三档颜色固定为 red / orange / blue，labelKey 原样透传", () => {
    const meta = priorityMeta({
      high: "interview.suggestions.priority.high",
      medium: "interview.suggestions.priority.medium",
      low: "interview.suggestions.priority.low",
    });

    expect(meta).toEqual({
      high: { labelKey: "interview.suggestions.priority.high", color: "red" },
      medium: { labelKey: "interview.suggestions.priority.medium", color: "orange" },
      low: { labelKey: "interview.suggestions.priority.low", color: "blue" },
    });
  });

  it("同一套颜色与各面板自己的文案 key 无关", () => {
    const job = priorityMeta({
      high: "jobAnalysis.priority.high",
      medium: "jobAnalysis.priority.medium",
      low: "jobAnalysis.priority.low",
    });
    const resume = priorityMeta({
      high: "resumeSuggestions.priority.high",
      medium: "resumeSuggestions.priority.medium",
      low: "resumeSuggestions.priority.low",
    });

    expect(job.high.color).toBe(resume.high.color);
    expect(job.medium.color).toBe(resume.medium.color);
    expect(job.low.color).toBe(resume.low.color);
    expect(job.high.labelKey).not.toBe(resume.high.labelKey);
  });

  it("少传一个 key 无法通过编译（三个档位必须齐全）", () => {
    // @ts-expect-error 缺 low：这正是"只抄了一半映射"在类型层面的堵口。
    const incomplete = priorityMeta({
      high: "interview.suggestions.priority.high",
      medium: "interview.suggestions.priority.medium",
    });

    // 运行时仍返回三档（low 的 labelKey 为 undefined），但编译期已经拦下这种写法。
    expect(Object.keys(incomplete)).toEqual(["high", "medium", "low"]);
  });
});
