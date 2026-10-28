// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位优化建议的后台提醒：**已并入统一任务表**。
 *
 * 与 `RiskScanWatcher.test.tsx` 同一个理由（别再挂第二个通知源），这里补上另一半：
 * **完成后跳哪**这张映射表。深链算错的表现很隐蔽——通知照样弹，只是点进去落到列表页，
 * 用户得自己再找一遍那份简历，于是"跑完了"这件事等于没说。
 */
import { describe, expect, it } from "vitest";
import type { AiTaskSnapshot } from "../types";
import {
  getBackgroundTaskAdapter,
  registeredBackgroundTaskKinds,
  updateFromAiTask,
} from "../utils/backgroundTasks.adapters";

function snapshot(kind: string, result_ref: Record<string, unknown> | null): AiTaskSnapshot {
  return {
    id: 1,
    kind,
    status: "succeeded",
    progress: 100,
    label: "",
    message: "",
    result_ref,
    error: "",
    created_at: "2026-10-28T10:00:00+08:00",
    started_at: "2026-10-28T10:00:00+08:00",
    finished_at: "2026-10-28T10:01:00+08:00",
  };
}

describe("岗位优化建议的后台提醒（统一出口）", () => {
  it("resume_rewrite 已登记适配器，通知文案取到了真实翻译", () => {
    expect(registeredBackgroundTaskKinds()).toContain("resume_rewrite");
    const adapter = getBackgroundTaskAdapter("resume_rewrite");
    expect(adapter).not.toBeNull();

    for (const value of Object.values(adapter!.notices())) {
      expect(value).toBeTruthy();
      expect(value).not.toMatch(/^backgroundTasks\./);
    }
  });

  it("四种新入口的完成深链各落到该去的地方", () => {
    // 岗位解读：直接打开解读弹窗（analysis=1 是 JobsPage 已在消费的既有参数）。
    expect(updateFromAiTask(snapshot("job_analysis", { job_id: 12 })).deepLink).toBe(
      "/jobs?job_id=12&analysis=1",
    );
    // 风险扫描 / 岗位化建议：结果都挂在简历上。
    expect(updateFromAiTask(snapshot("resume_risk", { resume_id: 7 })).deepLink).toBe(
      "/resumes?resume_id=7",
    );
    expect(updateFromAiTask(snapshot("resume_rewrite", { resume_id: 7 })).deepLink).toBe(
      "/resumes?resume_id=7",
    );
    // 网申是整页型结果，没有可定位的记录 id。
    expect(updateFromAiTask(snapshot("webform_fill", { webform: 1 })).deepLink).toBe("/webform");
  });

  it("结果标识缺失时不猜地址（宁可少一颗按钮，也不跳到不存在的记录）", () => {
    expect(updateFromAiTask(snapshot("resume_rewrite", null)).deepLink).toBeNull();
    expect(updateFromAiTask(snapshot("job_analysis", {})).deepLink).toBeNull();
  });

  it("result_ref 原样带给领域 store（没有业务表的那几种结果只能从这里回去）", () => {
    const ref = { resume_id: 7, risk_scan: { points: [] } };
    const update = updateFromAiTask(snapshot("resume_risk", ref));

    expect(update.resultData).toEqual(ref);
    expect(update.status).toBe("completed");
  });
});
