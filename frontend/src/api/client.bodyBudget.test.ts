// SPDX-License-Identifier: Apache-2.0
/**
 * A03：请求预算与取消必须覆盖**正文读取**。
 *
 * 背景：以前 `requestRaw` 一拿到响应头就在 `finally` 里清 timer / 摘监听，而 `request()`
 * 与 30+ 个导出调用方之后才 `resp.json()` / `resp.blob()`。于是"响应头秒回、正文挂起"的
 * 请求永远不会超时，用户按取消也中断不了正在读的正文。
 *
 * 单独成文件：A03 的用例带着自己的两个夹具（`pendingBodyResponse` / `lastEvent`），
 * 与 `client.test.ts` 的请求/错误分类用例没有共享状态；放在一起会顶破 500 行测试预算。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, BUDGETS_MS, isCancellation, request, requestRaw } from "./client";
import { clientDiagnosticSnapshot } from "../utils/clientDiagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("正文读取纳入预算与取消（A03）", () => {
  /**
   * 响应头立刻可用、正文永远读不完的响应。
   *
   * `pull` 返回一个永不 resolve 的 promise：若 pull 只是"什么都不做"，流规范会反复重试
   * pull（空转的微任务循环会把测试卡死）；挂起才是"正文卡住"这个语义。
   */
  function pendingBodyResponse(status = 200): { resp: Response; bodyReading: Promise<void> } {
    let notify = (): void => {};
    const bodyReading = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      pull() {
        notify();
        return new Promise<void>(() => {});
      },
    });
    return {
      resp: new Response(body, { status, headers: { "Content-Type": "application/json" } }),
      bodyReading,
    };
  }

  function lastEvent(): string | undefined {
    const snapshot = clientDiagnosticSnapshot();
    return snapshot[snapshot.length - 1]?.event;
  }

  it("响应头已回、正文挂起：预算到期以 timeout 拒绝，不误判成 network", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pendingBodyResponse().resp));

    const captured = request("/slow-body").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default);
    const err = await captured;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("请求超时，请重试");
    // 超时是传输层问题：诊断要记成 api.timeout，而不是"连不上本地服务"。
    expect(lastEvent()).toBe("api.timeout");
  });

  it("正文读取期间调用方 abort → cancelled，且不记任何诊断", async () => {
    const pending = pendingBodyResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pending.resp));
    const controller = new AbortController();
    const diagnosticsBefore = clientDiagnosticSnapshot().length;

    const captured = request("/slow-body", { signal: controller.signal }).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    // 等到底层流真的开始被读（响应头早已到手），再取消——这正是以前取消不掉的时段。
    await pending.bodyReading;
    controller.abort();
    const err = await captured;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("cancelled");
    expect(err.message).toBe("已取消");
    expect(isCancellation(err)).toBe(true);
    // 取消不是错误：不记诊断（尤其不能冒出一条 api.network_error）。
    expect(clientDiagnosticSnapshot().length).toBe(diagnosticsBefore);
  });

  it("Blob 导出正文读取期间 abort → cancelled（调用方拿到的仍是真正的 Response）", async () => {
    const pending = pendingBodyResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pending.resp));
    const controller = new AbortController();

    const resp = await requestRaw("/jobs/export", { budget: "export", signal: controller.signal });
    // 签名与返回类型不变：status/ok 语义与 instanceof 都必须成立，30+ 调用方不用改。
    expect(resp).toBeInstanceOf(Response);
    expect(resp.status).toBe(200);
    expect(resp.ok).toBe(true);

    const reading = resp.blob().then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    await pending.bodyReading;
    controller.abort();

    const err = await reading;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("cancelled");
  });

  it("Blob 导出正文读取期间预算到期 → timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pendingBodyResponse().resp));

    const resp = await requestRaw("/jobs/export", { budget: "default" });
    const reading = resp.blob().then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default);

    const err = await reading;
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("请求超时，请重试");
  });

  it("JSON 正常读完后 timer 与 abort 监听都已清理", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    await expect(request("/ok", { signal: controller.signal })).resolves.toEqual({ ok: 1 });

    // 只挂了一次，并且读完就摘掉了：长命 signal 上不会越积越多。
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith("abort", addSpy.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("正文读取失败（非法 JSON）后 timer 与监听同样清理，仍按 network 兜底", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    const err: ApiError = await request("/broken-body", { signal: controller.signal }).then(
      () => {
        throw new Error("should not resolve");
      },
      (error: ApiError) => error,
    );

    // 读取失败不是"取消"，也不该被说成超时：沿用旧的 network 兜底。
    expect(err.code).toBe("network");
    expect(removeSpy).toHaveBeenCalledWith("abort", addSpy.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("Blob 正常读完后 timer 已清理", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("zip-bytes", { status: 200 })));

    const resp = await requestRaw("/jobs/export", { budget: "export" });
    // 用内容断言而不是 `instanceof Blob`：jsdom 自带一个 Blob 构造器，Response 产出的是
    // 另一个 realm 的 Blob，`instanceof` 会假阴性（与本次改动无关）。
    expect(await (await resp.blob()).text()).toBe("zip-bytes");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("非 2xx 的错误正文读不完时按预算处理，不退回「请求失败（HTTP 500）」", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pendingBodyResponse(500).resp));

    const captured = request("/boom").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default);
    const err = await captured;

    expect(err.code).toBe("timeout");
    expect(err.message).toBe("请求超时，请重试");
  });
});
