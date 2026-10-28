// SPDX-License-Identifier: Apache-2.0
/**
 * `suggestionScanStore`：岗位优化建议的显示状态（执行已交给统一任务地基）。
 *
 * 这份 store 是**单例**，用例之间共享同一份 Map，所以每个用例前后都要
 * `resetSuggestionScan()` / `vi.clearAllMocks()`；否则上一条的 done 结果会漏进下一条。
 *
 * 替身的是 `utils/aiTaskEntry`（store 与地基之间的全部契约），成功路径用
 * `dispatchAiTaskResult` 模拟——建议**不入库**，只随 `result_ref` 回来一次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTask } from "../../utils/backgroundTasks.types";
import {
  cancelSuggestionScan,
  clearSuggestionScan,
  getSuggestionScanEntries,
  getSuggestionScanState,
  isSuggestionPanelAttached,
  markSuggestionPanelAttached,
  resetSuggestionScan,
  startSuggestionScan,
} from "./suggestionScanStore";

const entryMocks = vi.hoisted(() => ({
  startAiTask: vi.fn(),
  cancelAiTaskEntry: vi.fn(),
  attachAiTaskUi: vi.fn(),
}));
vi.mock("../../utils/aiTaskEntry", () => entryMocks);

import { dispatchAiTaskResult } from "../../utils/aiTaskResultSink";

/** 后端 `result_ref` 里那一份建议负载。 */
const RESULT_DATA = {
  resume_id: 7,
  job_id: 3,
  job_title: "后端开发工程师",
  company: "示例公司",
  suggestions: [
    {
      priority: "high",
      section: "项目经历",
      issue: "没有写到接口开发",
      suggestion: "补上接口 QPS",
      evidence: ["后端"],
    },
  ],
};

function finishedTask(status: BackgroundTask["status"], error = ""): BackgroundTask {
  return {
    key: "resume_rewrite#1",
    kind: "resume_rewrite",
    id: 1,
    label: "岗位优化建议",
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

function capturedOnFinished(call = 0) {
  const input = entryMocks.startAiTask.mock.calls[call][0] as {
    onFinished?: (task: BackgroundTask) => void;
  };
  return input.onFinished;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetSuggestionScan();
  vi.clearAllMocks();
  entryMocks.startAiTask.mockResolvedValue({ id: 1, key: "resume_rewrite#1" });
  entryMocks.cancelAiTaskEntry.mockResolvedValue(undefined);
  entryMocks.attachAiTaskUi.mockReturnValue(() => undefined);
});

afterEach(() => {
  resetSuggestionScan();
});

describe("suggestionScanStore", () => {
  it("start 进入 scanning，成功后建议由 sink 交付（带 job 元信息）", async () => {
    startSuggestionScan(7);

    const scanning = getSuggestionScanState(7);
    expect(scanning.status).toBe("scanning");
    expect(scanning.startedAt).toEqual(expect.any(Number));
    expect(entryMocks.startAiTask).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "resume_rewrite", payload: { resume_id: 7 } }),
    );

    dispatchAiTaskResult("resume_rewrite", 1, RESULT_DATA);
    await flush();

    const done = getSuggestionScanState(7);
    expect(done.status).toBe("done");
    expect(done.data?.suggestions).toHaveLength(1);
    expect(done.data?.job_title).toBe("后端开发工程师");
    expect(done.finishedAt).toEqual(expect.any(Number));
  });

  it("失败写 error，并把原因透传出去", async () => {
    startSuggestionScan(7);
    capturedOnFinished()?.(finishedTask("failed", "尚未配置大模型 API"));
    await flush();

    expect(getSuggestionScanState(7).status).toBe("error");
    expect(getSuggestionScanState(7).error).toBe("尚未配置大模型 API");
  });

  it("取消退回 idle，且不写 error", async () => {
    startSuggestionScan(7);
    await flush();
    cancelSuggestionScan(7);
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("resume_rewrite#1");
    expect(getSuggestionScanState(7).status).toBe("idle");
    expect(getSuggestionScanState(7).error).toBeUndefined();
  });

  it("同一份简历重复 start 只保留最新一次", async () => {
    startSuggestionScan(7);
    await flush();
    startSuggestionScan(7);
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("resume_rewrite#1");
    expect(entryMocks.startAiTask).toHaveBeenCalledTimes(2);
  });

  it("不同简历的状态互相隔离", async () => {
    startSuggestionScan(7);
    startSuggestionScan(9);
    dispatchAiTaskResult("resume_rewrite", 1, RESULT_DATA);
    await flush();

    expect(getSuggestionScanState(7).status).toBe("done");
    expect(getSuggestionScanState(9).status).toBe("scanning");
    expect(getSuggestionScanEntries().map((entry) => entry.resumeId)).toEqual([7, 9]);
  });

  it("clearSuggestionScan 丢掉这一份简历的槽，并取消在跑的任务", async () => {
    startSuggestionScan(7);
    await flush();

    clearSuggestionScan(7);
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("resume_rewrite#1");
    expect(getSuggestionScanState(7).status).toBe("idle");
    // 迟到的结果不能把已经清掉的槽写回来。
    dispatchAiTaskResult("resume_rewrite", 1, RESULT_DATA);
    await flush();
    expect(getSuggestionScanState(7).status).toBe("idle");
  });

  it("弹窗附着用计数（StrictMode 双挂载不会误判）", async () => {
    startSuggestionScan(7);
    await flush();

    const detachFirst = markSuggestionPanelAttached(7);
    const detachSecond = markSuggestionPanelAttached(7);
    expect(isSuggestionPanelAttached(7)).toBe(true);
    expect(entryMocks.attachAiTaskUi).toHaveBeenCalledWith("resume_rewrite#1");

    detachFirst();
    expect(isSuggestionPanelAttached(7)).toBe(true);
    detachSecond();
    expect(isSuggestionPanelAttached(7)).toBe(false);
  });

  it("reset 清空所有槽", async () => {
    startSuggestionScan(7);
    markSuggestionPanelAttached(7);
    resetSuggestionScan();

    expect(getSuggestionScanState(7).status).toBe("idle");
    expect(isSuggestionPanelAttached(7)).toBe(false);
  });
});
