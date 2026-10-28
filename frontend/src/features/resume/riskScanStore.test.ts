// SPDX-License-Identifier: Apache-2.0
/**
 * 风险扫描 store：状态机、结果交付、取消、重复发起、多简历互不影响。
 *
 * 执行已交给统一任务地基，所以这里替身的是 `utils/aiTaskEntry`（store 与地基之间的
 * 全部契约），成功路径用 `dispatchAiTaskResult` 模拟——**扫描报告不入库，只能随
 * `result_ref` 回来**，这条正是本 store 与其它两个 store 的实质差别，必须被钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeRiskScan } from "../../types/resumeRisk";
import type { BackgroundTask } from "../../utils/backgroundTasks.types";
import {
  cancelRiskScan,
  getRiskScanEntries,
  getRiskScanState,
  isRiskPanelAttached,
  markRiskPanelAttached,
  resetRiskScanStore,
  startRiskScan,
} from "./riskScanStore";

const entryMocks = vi.hoisted(() => ({
  startAiTask: vi.fn(),
  cancelAiTaskEntry: vi.fn(),
  attachAiTaskUi: vi.fn(),
}));
vi.mock("../../utils/aiTaskEntry", () => entryMocks);

import { dispatchAiTaskResult } from "../../utils/aiTaskResultSink";

const RESULT: ResumeRiskScan = {
  resume_id: 7,
  points: [
    {
      category: "compliance",
      severity: "high",
      text: "保密协议",
      location: "正文",
      suggestion: "投递前请确认",
      claim_id: null,
      follow_up: [],
    },
  ],
  summary: { compliance: 1 },
  remote_enhancement_available: true,
  llm_used: false,
  notes: [],
};

/** 一个终态任务快照（只填 store 会用到的字段）。 */
function finishedTask(status: BackgroundTask["status"], error = ""): BackgroundTask {
  return {
    key: "resume_risk#1",
    kind: "resume_risk",
    id: 1,
    label: "简历风险扫描",
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
  resetRiskScanStore();
  vi.clearAllMocks();
  entryMocks.startAiTask.mockResolvedValue({ id: 1, key: "resume_risk#1" });
  entryMocks.cancelAiTaskEntry.mockResolvedValue(undefined);
  entryMocks.attachAiTaskUi.mockReturnValue(() => undefined);
});

afterEach(() => {
  resetRiskScanStore();
});

describe("riskScanStore", () => {
  it("start 立刻进入 scanning（带签名与增强开关），成功时报告由 sink 交付", async () => {
    startRiskScan(7, { enhance: false, signature: "sig-1" });

    const scanning = getRiskScanState(7);
    expect(scanning.status).toBe("scanning");
    expect(scanning.startedAt).toEqual(expect.any(Number));
    expect(scanning.signature).toBe("sig-1");
    expect(scanning.enhance).toBe(false);
    // 增强开关必须进 payload：它决定后端是否把简历发给模型（RR-01）。
    expect(entryMocks.startAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "resume_risk",
        payload: { resume_id: 7, enhance: false },
      }),
    );

    dispatchAiTaskResult("resume_risk", 1, { resume_id: 7, risk_scan: RESULT });
    await flush();

    const done = getRiskScanState(7);
    expect(done.status).toBe("done");
    expect(done.result?.points).toHaveLength(1);
    expect(done.finishedAt).toEqual(expect.any(Number));
  });

  it("真实失败写 error，并把后端信息透出", async () => {
    startRiskScan(7, { enhance: true });
    capturedOnFinished()?.(finishedTask("failed", "模型不可用"));
    await flush();

    expect(getRiskScanState(7).status).toBe("error");
    expect(getRiskScanState(7).error).toBe("模型不可用");
  });

  it("取消回到 idle 且不写 error（取消不是失败）", async () => {
    startRiskScan(7, { enhance: true });
    await flush();
    cancelRiskScan(7);
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("resume_risk#1");
    expect(getRiskScanState(7).status).toBe("idle");
    expect(getRiskScanState(7).error).toBeUndefined();
  });

  it("同一份简历重复 start 只保留最新一次", async () => {
    startRiskScan(7, { enhance: true, signature: "old" });
    await flush();
    startRiskScan(7, { enhance: true, signature: "new" });
    await flush();

    expect(entryMocks.cancelAiTaskEntry).toHaveBeenCalledWith("resume_risk#1");
    expect(getRiskScanState(7).signature).toBe("new");
  });

  it("不同简历的扫描互不影响", async () => {
    startRiskScan(7, { enhance: true });
    startRiskScan(9, { enhance: true });

    dispatchAiTaskResult("resume_risk", 1, { resume_id: 7, risk_scan: RESULT });
    await flush();

    expect(getRiskScanState(7).status).toBe("done");
    expect(getRiskScanState(9).status).toBe("scanning");
    expect(getRiskScanEntries().map((entry) => entry.resumeId)).toEqual([7, 9]);
  });

  it("面板附着用计数（StrictMode 双挂载不会误判），并声明任务 UI 在看着", async () => {
    startRiskScan(7, { enhance: true });
    await flush();

    const detachFirst = markRiskPanelAttached(7);
    const detachSecond = markRiskPanelAttached(7);
    expect(isRiskPanelAttached(7)).toBe(true);
    expect(entryMocks.attachAiTaskUi).toHaveBeenCalledWith("resume_risk#1");

    detachFirst();
    expect(isRiskPanelAttached(7)).toBe(true);
    detachSecond();
    expect(isRiskPanelAttached(7)).toBe(false);
  });

  it("reset 清空所有槽", async () => {
    startRiskScan(7, { enhance: true });
    markRiskPanelAttached(7);
    resetRiskScanStore();

    expect(getRiskScanState(7).status).toBe("idle");
    expect(isRiskPanelAttached(7)).toBe(false);
  });
});
