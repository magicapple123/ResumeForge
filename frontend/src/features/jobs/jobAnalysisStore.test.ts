/**
 * jobAnalysisStore：模块级岗位解读状态机（T1）。
 *
 * 单例 store 在用例之间共享同一份 Map，所以每条前后都 `resetJobAnalysisStoreForTests()`
 * 并清 mock；断言全部基于真实状态变化，用 deferred 手动 resolve，不 sleep。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
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

const apiMocks = vi.hoisted(() => ({ generateJobAnalysis: vi.fn() }));
// store 只从 api/jobs 取这一个函数，mock 到这个粒度就够。
vi.mock("../../api/jobs", () => apiMocks);

const noticeMocks = vi.hoisted(() => ({
  announceBackgroundResult: vi.fn(),
  announceBackgroundFailure: vi.fn(),
}));
// 通知出口换成替身：这里要断言"用户走了才通知"，不是去测弹窗怎么画。
vi.mock("../../utils/backgroundTask", () => noticeMocks);

const mockedGenerate = apiMocks.generateJobAnalysis;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function analysis(summary: string): JobAnalysisResult {
  return {
    summary,
    requirements: [
      { priority: "high", category: "职业资质", requirement: "持有执业资格证", evidence: "" },
    ],
    advice: [{ title: "突出经验", action: "写清项目结果", rationale: "" }],
  };
}

/** 让 store 里 promise 回调（微任务）跑完。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetJobAnalysisStoreForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  resetJobAnalysisStoreForTests();
});

describe("jobAnalysisStore", () => {
  it("start 进入 running（带 title/company/startedAt），resolve 后变 done", async () => {
    const pending = deferred<JobAnalysisResult>();
    mockedGenerate.mockReturnValue(pending.promise);

    startJobAnalysis({ jobId: 7, title: "算法工程师", company: "字节跳动" });

    const running = getJobAnalysisState(7);
    expect(running.status).toBe("running");
    expect(running.title).toBe("算法工程师");
    expect(running.company).toBe("字节跳动");
    expect(running.startedAt).toEqual(expect.any(Number));
    expect(running.background).toBe(false);
    // 顶部任务条据此出 chip。
    expect(getRunningJobAnalyses().map((entry) => entry.jobId)).toEqual([7]);

    pending.resolve(analysis("第一版结论"));
    await flush();

    const done = getJobAnalysisState(7);
    expect(done.status).toBe("done");
    expect(done.result?.summary).toBe("第一版结论");
    expect(done.finishedAt).toEqual(expect.any(Number));
    expect(getRunningJobAnalyses()).toHaveLength(0);
    // 有人在看的时候不弹全局通知（结果已经画在弹窗里了）。
    expect(noticeMocks.announceBackgroundResult).not.toHaveBeenCalled();
  });

  it("cancel 真的 abort 请求，并把状态退回 idle（不留 error、不留结果）", async () => {
    let signal: AbortSignal | undefined;
    mockedGenerate.mockImplementation((_id: number, nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return new Promise<JobAnalysisResult>(() => undefined);
    });

    startJobAnalysis({ jobId: 8, title: "运营" });
    expect(signal?.aborted).toBe(false);

    cancelJobAnalysis(8);

    expect(signal?.aborted).toBe(true);
    expect(getJobAnalysisState(8).status).toBe("idle");
    expect(getJobAnalysisState(8).result).toBeUndefined();
    expect(getJobAnalysisState(8).error).toBeUndefined();
    expect(getRunningJobAnalyses()).toHaveLength(0);
  });

  it("请求被 abort 后落地的 cancelled 失败不会把状态写成 error", async () => {
    const pending = deferred<JobAnalysisResult>();
    mockedGenerate.mockReturnValue(pending.promise);

    startJobAnalysis({ jobId: 11 });
    cancelJobAnalysis(11);
    pending.reject(new ApiError("已取消", undefined, { code: "cancelled" }));
    await flush();

    expect(getJobAnalysisState(11).status).toBe("idle");
    expect(noticeMocks.announceBackgroundFailure).not.toHaveBeenCalled();
  });

  it("detach 之后完成会发统一通知，且结果照样留在槽里", async () => {
    const pending = deferred<JobAnalysisResult>();
    mockedGenerate.mockReturnValue(pending.promise);

    startJobAnalysis({ jobId: 9, title: "护士", company: "示例医院" });
    detachJobAnalysis(9);
    expect(getJobAnalysisState(9).background).toBe(true);

    pending.resolve(analysis("后台跑完的结论"));
    await flush();

    expect(getJobAnalysisState(9).status).toBe("done");
    expect(noticeMocks.announceBackgroundResult).toHaveBeenCalledTimes(1);
    expect(noticeMocks.announceBackgroundResult).toHaveBeenCalledWith(
      "岗位解读",
      expect.stringContaining("岗位需求解读"),
    );
  });

  it("detach 之后失败也会通知（失败更需要知道）", async () => {
    const pending = deferred<JobAnalysisResult>();
    mockedGenerate.mockReturnValue(pending.promise);

    startJobAnalysis({ jobId: 12 });
    detachJobAnalysis(12);
    pending.reject(new Error("模型不可用"));
    await flush();

    expect(getJobAnalysisState(12).status).toBe("error");
    expect(getJobAnalysisState(12).error).toBe("模型不可用");
    expect(noticeMocks.announceBackgroundFailure).toHaveBeenCalledWith("岗位解读", "模型不可用");
  });

  it("重新打开弹窗（attach）之后完成就不再弹全局通知", async () => {
    const pending = deferred<JobAnalysisResult>();
    mockedGenerate.mockReturnValue(pending.promise);

    startJobAnalysis({ jobId: 13 });
    detachJobAnalysis(13);
    attachJobAnalysis(13);
    expect(getJobAnalysisState(13).background).toBe(false);

    pending.resolve(analysis("回填的结论"));
    await flush();

    expect(getJobAnalysisState(13).status).toBe("done");
    expect(noticeMocks.announceBackgroundResult).not.toHaveBeenCalled();
  });

  it("重复 start 只保留最新一次：旧请求的结果被丢弃", async () => {
    const first = deferred<JobAnalysisResult>();
    const second = deferred<JobAnalysisResult>();
    mockedGenerate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    startJobAnalysis({ jobId: 14 });
    const firstSignal = mockedGenerate.mock.calls[0][1] as AbortSignal;
    startJobAnalysis({ jobId: 14 });

    // 旧请求被主动 abort（用户连点 / 换了个入口重来）。
    expect(firstSignal.aborted).toBe(true);

    first.resolve(analysis("旧结果"));
    await flush();
    expect(getJobAnalysisState(14).status).toBe("running");

    second.resolve(analysis("新结果"));
    await flush();
    expect(getJobAnalysisState(14).status).toBe("done");
    expect(getJobAnalysisState(14).result?.summary).toBe("新结果");
  });

  it("force 透传给 api（只有「重新生成」才绕过缓存）", async () => {
    mockedGenerate.mockResolvedValue(analysis("x"));

    startJobAnalysis({ jobId: 15, force: true });

    expect(mockedGenerate).toHaveBeenCalledWith(15, expect.any(AbortSignal), true);
  });

  it("reset 清空全部槽，并 abort 在途请求", async () => {
    let signal: AbortSignal | undefined;
    mockedGenerate.mockImplementation((_id: number, nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return new Promise<JobAnalysisResult>(() => undefined);
    });

    startJobAnalysis({ jobId: 16 });
    resetJobAnalysisStoreForTests();

    expect(signal?.aborted).toBe(true);
    expect(getJobAnalysisState(16).status).toBe("idle");
    expect(getRunningJobAnalyses()).toHaveLength(0);
  });
});
