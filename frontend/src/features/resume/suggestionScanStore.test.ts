/**
 * suggestionScanStore：模块级生成状态机。
 *
 * 这份 store 是**单例**，用例之间共享同一份 Map，所以每个用例前后都要
 * `resetSuggestionScan()` / `vi.clearAllMocks()`；否则上一条的 done 结果会漏进下一条。
 *
 * 断言全部基于"真实状态变化"：deferred promise 手动 resolve，不用固定 sleep。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { ResumeSuggestions } from "../../types";
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

const apiMocks = vi.hoisted(() => ({ generateResumeSuggestions: vi.fn() }));

// store 只从 api/resumes 取这一个函数，mock 到这个粒度就够。
vi.mock("../../api/resumes", () => apiMocks);

const mockedGenerate = apiMocks.generateResumeSuggestions;

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

function payload(jobTitle: string): ResumeSuggestions {
  return {
    job_id: 3,
    job_title: jobTitle,
    company: "示例公司",
    suggestions: [
      {
        priority: "high",
        section: "项目经历",
        issue: "缺少量化结果",
        suggestion: "补充可核对的数字",
        evidence: [],
      },
    ],
  };
}

/** 让 store 里 promise 回调（微任务）跑完。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetSuggestionScan();
  vi.clearAllMocks();
});

afterEach(() => {
  resetSuggestionScan();
});

describe("suggestionScanStore", () => {
  it("start 进入 scanning（带 startedAt），resolve 后变 done（带 data 与 finishedAt）", async () => {
    const pending = deferred<ResumeSuggestions>();
    mockedGenerate.mockReturnValue(pending.promise);

    expect(getSuggestionScanState(7).status).toBe("idle");

    startSuggestionScan(7);

    const scanning = getSuggestionScanState(7);
    expect(scanning.status).toBe("scanning");
    expect(scanning.startedAt).toEqual(expect.any(Number));
    expect(scanning.finishedAt).toBeUndefined();
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
    expect(mockedGenerate.mock.calls[0][0]).toBe(7);

    pending.resolve(payload("前端工程师"));
    await flush();

    const done = getSuggestionScanState(7);
    expect(done.status).toBe("done");
    expect(done.data?.job_title).toBe("前端工程师");
    expect(done.finishedAt).toEqual(expect.any(Number));
    expect(done.error).toBeUndefined();
  });

  it("reject 后进入 error，并把错误信息透传出去", async () => {
    mockedGenerate.mockRejectedValue(new Error("模型服务不可用"));

    startSuggestionScan(7);
    await flush();

    const failed = getSuggestionScanState(7);
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("模型服务不可用");
    expect(failed.data).toBeUndefined();
  });

  it("cancel 退回 idle 且不留 error，被 abort 的 promise 也不会再写 error", async () => {
    // 模拟真实请求：signal 一 abort 就 reject 一个 cancelled 的 ApiError。
    mockedGenerate.mockImplementation(
      (_id: number, signal?: AbortSignal) =>
        new Promise<ResumeSuggestions>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new ApiError("已取消", undefined, { code: "cancelled" }));
          });
        }),
    );

    startSuggestionScan(7);
    const signal = mockedGenerate.mock.calls[0][1] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);

    cancelSuggestionScan(7);

    expect(signal?.aborted).toBe(true);
    expect(getSuggestionScanState(7).status).toBe("idle");
    expect(getSuggestionScanState(7).error).toBeUndefined();

    // 取消之后那次 reject 落地：状态必须还是 idle（取消不是错误）。
    await flush();
    expect(getSuggestionScanState(7).status).toBe("idle");
    expect(getSuggestionScanState(7).error).toBeUndefined();
  });

  it("同一份简历重复 start 只保留最新一次，旧结果不覆盖新结果", async () => {
    const first = deferred<ResumeSuggestions>();
    const second = deferred<ResumeSuggestions>();
    mockedGenerate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    startSuggestionScan(7);
    startSuggestionScan(7);

    expect(mockedGenerate).toHaveBeenCalledTimes(2);
    // 旧请求被 abort 掉，避免两份结果抢同一个槽。
    const firstSignal = mockedGenerate.mock.calls[0][1] as AbortSignal | undefined;
    expect(firstSignal?.aborted).toBe(true);

    first.resolve(payload("过期的岗位"));
    await flush();
    // 旧 promise 晚到也不能把界面从 scanning 拽出来。
    expect(getSuggestionScanState(7).status).toBe("scanning");

    second.resolve(payload("最新岗位"));
    await flush();

    const done = getSuggestionScanState(7);
    expect(done.status).toBe("done");
    expect(done.data?.job_title).toBe("最新岗位");
  });

  it("不同简历的状态互相隔离", async () => {
    const firstResume = deferred<ResumeSuggestions>();
    const secondResume = deferred<ResumeSuggestions>();
    mockedGenerate
      .mockReturnValueOnce(firstResume.promise)
      .mockReturnValueOnce(secondResume.promise);

    startSuggestionScan(7);
    startSuggestionScan(8);

    firstResume.resolve(payload("岗位 A"));
    await flush();

    expect(getSuggestionScanState(7).status).toBe("done");
    expect(getSuggestionScanState(7).data?.job_title).toBe("岗位 A");
    expect(getSuggestionScanState(8).status).toBe("scanning");
    expect(getSuggestionScanState(8).data).toBeUndefined();

    secondResume.resolve(payload("岗位 B"));
    await flush();

    expect(getSuggestionScanState(8).data?.job_title).toBe("岗位 B");
    expect(getSuggestionScanState(7).data?.job_title).toBe("岗位 A");
  });

  it("markSuggestionPanelAttached 用计数：两个 attach 一次 detach 仍附着", () => {
    const detachOuter = markSuggestionPanelAttached(7);
    const detachInner = markSuggestionPanelAttached(7);
    expect(isSuggestionPanelAttached(7)).toBe(true);

    detachInner();
    // StrictMode 双挂载 / 嵌套两处 attach 时，第一次清理不能把标记抹掉。
    expect(isSuggestionPanelAttached(7)).toBe(true);

    detachOuter();
    expect(isSuggestionPanelAttached(7)).toBe(false);
    // 重复 detach 是幂等的（返回的清理函数可能被 React 调两次）。
    detachOuter();
    expect(isSuggestionPanelAttached(7)).toBe(false);
  });

  it("entries 快照覆盖所有槽，reset 后清空", async () => {
    mockedGenerate.mockResolvedValue(payload("前端工程师"));

    startSuggestionScan(7);
    await flush();

    expect(getSuggestionScanEntries().map((entry) => entry.resumeId)).toEqual([7]);
    expect(getSuggestionScanEntries()[0].state.status).toBe("done");

    resetSuggestionScan();

    expect(getSuggestionScanEntries()).toEqual([]);
    expect(getSuggestionScanState(7).status).toBe("idle");
    expect(isSuggestionPanelAttached(7)).toBe(false);
  });

  it("clearSuggestionScan 丢掉这一份简历的槽，在跑的请求也不回写", async () => {
    const pending = deferred<ResumeSuggestions>();
    mockedGenerate.mockReturnValue(pending.promise);

    startSuggestionScan(7);
    clearSuggestionScan(7);

    expect(getSuggestionScanState(7).status).toBe("idle");

    pending.resolve(payload("前端工程师"));
    await flush();

    // 简历内容已经改过，旧请求的结果不该再出现在槽里。
    expect(getSuggestionScanState(7).status).toBe("idle");
    expect(getSuggestionScanState(7).data).toBeUndefined();
  });
});
