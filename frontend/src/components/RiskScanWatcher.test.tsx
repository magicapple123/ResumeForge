// SPDX-License-Identifier: Apache-2.0
/**
 * 风险扫描的后台提醒：**已并入统一任务表**，这里钉住"别再挂第二个通知源"。
 *
 * 历史形态：扫描状态在 `features/resume/riskScanStore` 里，`RiskScanWatcher` 挂在布局层
 * 订阅它、自己弹通知卡片。本轮把风险扫描接进 `/ai-tasks` 之后，进度与完成提醒都由
 * `utils/backgroundTasks` + `BackgroundTasksIndicator` 统一负责——**同一件事只有一个出口**。
 *
 * 于是守卫要防的不是"watcher 写错了"，而是"有人把它又挂回去"：那样用户会为一次扫描
 * 收到两张卡片（一张来自 watcher、一张来自统一出口），这正是本轮在收敛的老毛病。
 */
import { describe, expect, it } from "vitest";
import appShellSource from "./shell/AppShell.tsx?raw";
import {
  getBackgroundTaskAdapter,
  registeredBackgroundTaskKinds,
} from "../utils/backgroundTasks.adapters";

/** 去掉注释再判定：文件里会解释"为什么不再挂载"，那是说明不是装配。 */
function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("风险扫描的后台提醒（统一出口）", () => {
  it("布局层不再挂载 RiskScanWatcher / SuggestionScanWatcher（避免同一件事响两次）", () => {
    const code = stripComments(appShellSource);

    expect(code).not.toMatch(/<RiskScanWatcher\b/);
    expect(code).not.toMatch(/<SuggestionScanWatcher\b/);
  });

  it("resume_risk 已登记适配器，且通知文案取到了真实翻译（缺 key 会原样返回 key）", () => {
    expect(registeredBackgroundTaskKinds()).toContain("resume_risk");
    const adapter = getBackgroundTaskAdapter("resume_risk");
    expect(adapter).not.toBeNull();

    const notices = adapter!.notices();
    for (const value of Object.values(notices)) {
      expect(value).toBeTruthy();
      expect(value).not.toMatch(/^backgroundTasks\./);
    }
    // 「去查看」那颗按钮必须指向简历（结果挂在简历上）。
    expect(notices.viewLabel).toBeTruthy();
  });
});
