/** 风险扫描 store：状态机、取消、重复发起、多简历互不影响。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { ResumeRiskScan } from "../../types/resumeRisk";
import {
  cancelRiskScan,
  getRiskScanState,
  resetRiskScanStore,
  startRiskScan,
} from "./riskScanStore";

const apiMocks = vi.hoisted(() => ({ scanResumeRisks: vi.fn() }));

vi.mock("../../api/resumeRisk", () => apiMocks);

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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetRiskScanStore();
  apiMocks.scanResumeRisks.mockReset();
});

afterEach(() => {
  resetRiskScanStore();
});

describe("riskScanStore", () => {
  it("start → scanning → done，并记录签名与耗时", async () => {
    const pending = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValue(pending.promise);

    expect(getRiskScanState(7).status).toBe("idle");
    startRiskScan(7, { enhance: true, signature: "sig-1" });

    const scanning = getRiskScanState(7);
    expect(scanning.status).toBe("scanning");
    expect(scanning.enhance).toBe(true);
    expect(scanning.signature).toBe("sig-1");
    expect(typeof scanning.startedAt).toBe("number");
    expect(apiMocks.scanResumeRisks).toHaveBeenCalledTimes(1);
    expect(apiMocks.scanResumeRisks.mock.calls[0][0]).toBe(7);
    expect(apiMocks.scanResumeRisks.mock.calls[0][1]).toBe(true);

    pending.resolve(RESULT);
    await vi.waitFor(() => expect(getRiskScanState(7).status).toBe("done"));
    const done = getRiskScanState(7);
    expect(done.result?.points).toHaveLength(1);
    expect(typeof done.finishedAt).toBe("number");
    expect(done.signature).toBe("sig-1");
  });

  it("cancel 回到 idle 且不写 error（取消不是失败）", async () => {
    apiMocks.scanResumeRisks.mockImplementation(
      (_id: number, _enhance: boolean, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new ApiError("已取消", undefined, { code: "cancelled" })),
          );
        }),
    );

    startRiskScan(7, { enhance: false });
    expect(getRiskScanState(7).status).toBe("scanning");

    cancelRiskScan(7);
    expect(getRiskScanState(7).status).toBe("idle");
    // 让 abort 引发的 rejection 真的跑完：状态必须还停在 idle，且没有 error。
    await Promise.resolve();
    await Promise.resolve();
    const state = getRiskScanState(7);
    expect(state.status).toBe("idle");
    expect(state.error).toBeUndefined();
  });

  it("同一份简历重复 start 只保留最新一次的结果", async () => {
    const first = deferred<typeof RESULT>();
    const second = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    startRiskScan(7, { enhance: true, signature: "old" });
    startRiskScan(7, { enhance: false, signature: "new" });
    expect(apiMocks.scanResumeRisks).toHaveBeenCalledTimes(2);

    // 旧请求晚回来：不能覆盖新请求的状态。
    first.resolve({ ...RESULT, resume_id: 7, notes: ["旧结果"] });
    await Promise.resolve();
    await Promise.resolve();
    expect(getRiskScanState(7).status).toBe("scanning");

    second.resolve(RESULT);
    await vi.waitFor(() => expect(getRiskScanState(7).status).toBe("done"));
    expect(getRiskScanState(7).signature).toBe("new");
    expect(getRiskScanState(7).enhance).toBe(false);
  });

  it("不同简历的扫描互不影响", async () => {
    const first = deferred<typeof RESULT>();
    const second = deferred<typeof RESULT>();
    apiMocks.scanResumeRisks.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    startRiskScan(1, { enhance: true });
    startRiskScan(2, { enhance: true });

    first.resolve({ ...RESULT, resume_id: 1 });
    await vi.waitFor(() => expect(getRiskScanState(1).status).toBe("done"));
    expect(getRiskScanState(2).status).toBe("scanning");

    second.resolve({ ...RESULT, resume_id: 2 });
    await vi.waitFor(() => expect(getRiskScanState(2).status).toBe("done"));
  });

  it("真实失败写 error，并把后端信息透出", async () => {
    apiMocks.scanResumeRisks.mockRejectedValue(new ApiError("风险扫描失败", 500));
    startRiskScan(7, { enhance: true });
    await vi.waitFor(() => expect(getRiskScanState(7).status).toBe("error"));
    expect(getRiskScanState(7).error).toBe("风险扫描失败");
  });
});
