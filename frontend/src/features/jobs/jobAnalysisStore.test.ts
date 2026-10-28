// SPDX-License-Identifier: Apache-2.0
/**
 * `jobAnalysisStore`：岗位解读的**显示状态**（执行已交给统一任务地基）。
 *
 * 这一版只验三件事，且都不依赖任何网络/轮询细节：
 * 1. 发起时立刻进入 `running`（界面不会空着等第一次轮询）；
 * 2. **成功**由 `aiTaskResultSink` 派发（这条路径也覆盖"刷新后恢复"），store 再去读一次
 *    服务端缓存并把结果写进槽；
 * 3. **失败 / 取消**由 `onFinished` 收尾，且取消不会被写成 error。
 *
 * 用替身替换 `utils/aiTaskEntry` 而不是替换 `api/aiTasks`：那三个函数就是 store 与任务
 * 地基之间的**全部**契约，替掉它们等于把 store 的行为边界钉死；再往下一层去 mock HTTP
 * 会让用例重新测一遍任务地基（那由 `utils/backgroundTasks.aiTasks.test.ts` 负责）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entryMocks = vi.hoisted(() => ({
  startAiTask: vi.fn(),
  cancelAiTaskEntry: vi.fn(),
  attachAiTaskUi: vi.fn(),
}));
vi.mock("../../utils/aiTaskEntry", () => entryMocks);

import { dispatchAiTaskResult } from "../../utils/aiTaskResultSink";
import type { BackgroundTask } from "../../utils/backgroundTasks.types";
import type { JobAnalysisResult } from "../../types";
import {
  attachJobAnalysis,
  cancelJobAnalysis,
  detachJobAnalysis,
  getJobAnalysisState,
  getRunningJobAnalyses,
  resetJobAnalysisStoreForTests,
  startJobAnalysis,
} from "./jobAnalysisStore";

function analysis(summary: string): JobAnalysisResult {
  return {
    summary,
    requirements: [
      { priority: "high", category: "职业资质", requirement: "持有执业资格证", evidence: "" },
    ],
    advice: [{ title: "突出经验", action: "写清项目结果", rationale: "" }],
  };
}

/** 一个终态任务快照（只填 store 会用到的字段）。 */
function finishedTask(status: BackgroundTask["status"], error = ""): BackgroundTask {
  return {
    key: "job_analysis#1",
    kind: "job_analysis",
    id: 1,
    label: "岗位解读",
    status,
    message: "",
    progressPercent: null,
    receivedChars: 0,
    resumeId: null,
    refId: null,
    deepLink: null,
    resultData: null,
    error,
    unknown: false,
  };
}

/** 让 store 里的 promise 回调（微任务）跑完。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 取出 `startAiTask` 收到的 `onFinished`（收尾路径由它驱动）。 */
function capturedOnFinished(call = 0) {
  const input = entryMocks.startAiTask.mock.calls[call][0] as {
    onFinished?: (task: BackgroundTask) => void;
  };
  return input.onFinished;
}

beforeEach(() => {
  resetJobAnalysisStoreForTests();
  vi.clearAllMocks();
  entryMocks.startAiTask.mockResolvedValue({ id: 1, key: "job_analysis#1" });
  entryMocks.cancelAiTaskEntry.mockResolvedValue(undefined);
  entryMocks.attachAiTaskUi.mockReturnValue(() => undefined);
});

afterEach(() => {
  resetJobAnalysisStoreForTests();
});

describe("jobAnalysisStore", () => {
  it("start 立刻进入 running（带 title/company/startedAt），成功后由 sink 交付结果", async () => {
    startJobAnalysis({ jobId: 7, title: "算法工程师", company: "字节跳动" });

    const running = getJobAnalysisState(7);
    expect(running.status).toBe("running");
    expect(running.title).toBe("算法工程师");
    expect(running.company).toBe("字节跳动");
    expect(running.startedAt).toEqual(expect.any(Number));
    expect(running.background).toBe(false);
    // 页头计数据此出 chip。
    expect(getRunningJobAnalyses().map((entry) => entry.jobId)).toEqual([7]);

    // 任务成功：结论随 result_ref 一起回来，直接填进槽（不必再读一次缓存）。
    dispatchAiTaskResult("job_analysis", 1, { job_id: 7, analysis: analysis("第一版结论") });
    await flush();

    const done = getJobAnalysisState(7);
    expect(done.status).toBe("done");
    expect(done.result?.summary).toBe("第一版结论");
    expect(done.finishedAt).toEqual(expect.any(Number));
    expect(getRunningJobAnalyses()).toHaveLength(0);
  });

  it("同一任务被派发两次只交付一次（刷新恢复 + 正常轮询会各派发一次）", async () => {
    startJobAnalysis({ jobId: 7 });
    dispatchAiTaskResult("job_analysis", 1, { job_id: 7, analysis: analysis("第一次") });
    const finishedAt = getJobAnalysisState(7).finishedAt;
    dispatchAiTaskResult("job_analysis", 1, { job_id: 7, analysis: analysis("第二次") });
    await flush();

    expect(getJobAnalysisState(7).result?.summary).toBe("第一次");
    expect(getJobAnalysisState(7).finishedAt).toBe(finishedAt);
  });

  it("任务失败写 error 并把后端原因透出", async () => {
    startJobAnalysis({ jobId: 12 });
    capturedOnFinished()?.(finishedTask("failed", "模型不可用"));
    await flush();

    expect(getJobAnalysisState(12).status).toBe("error");
    expect(getJobAnalysisState(12).error).toBe("模型不可用");
  });

  it("任务被取消 / 未配置模型时退回 idle（取消不是错误）", async () => {
    startJobAnalysis({ jobId: 8 });
    capturedOnFinished()?.(finishedTask("cancelled"));
    await flush();

    expect(getJobAnalysisState(8).status).toBe("idle");
    expect(getJobAnalysisState(8).error).toBeUndefined();
  });

  it("cancel 取消的是后端任务（真停），并把状态退回 idle", async () => {
    startJobAnalysis({ jobId: 8, title: "运营" });
    await flush(); // 等 startAiTask 的 then 把 task id 记下来

    cancelJobAnalysis(8);
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("job_analysis#1");
    expect(getJobAnalysisState(8).status).toBe("idle");
    expect(getJobAnalysisState(8).result).toBeUndefined();
    expect(getJobAnalysisState(8).error).toBeUndefined();
    expect(getRunningJobAnalyses()).toHaveLength(0);
  });

  it("重复 start 先取消上一次的任务（两次生成不该并行烧 token）", async () => {
    startJobAnalysis({ jobId: 14 });
    await flush();
    startJobAnalysis({ jobId: 14 });
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("job_analysis#1");
    expect(entryMocks.startAiTask).toHaveBeenCalledTimes(2);
  });

  it("force 透传进任务 payload（只有「重新生成」才绕过缓存）", async () => {
    startJobAnalysis({ jobId: 15, force: true });

    expect(entryMocks.startAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "job_analysis",
        payload: { job_id: 15, force: true },
      }),
    );
  });

  it("attach 声明「有人在看」，detach 收回（完成提醒据此决定是否打断）", async () => {
    startJobAnalysis({ jobId: 9, title: "护士", company: "示例医院" });
    await flush();

    attachJobAnalysis(9);
    expect(entryMocks.attachAiTaskUi).toHaveBeenCalledWith("job_analysis#1");
    expect(getJobAnalysisState(9).background).toBe(false);

    detachJobAnalysis(9);
    expect(getJobAnalysisState(9).background).toBe(true);
  });

  it("reset 清空全部槽并释放附着声明", async () => {
    startJobAnalysis({ jobId: 16 });
    await flush();
    attachJobAnalysis(16);
    resetJobAnalysisStoreForTests();

    expect(getJobAnalysisState(16).status).toBe("idle");
    expect(getRunningJobAnalyses()).toHaveLength(0);
  });
});
