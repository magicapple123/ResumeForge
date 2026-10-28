// SPDX-License-Identifier: Apache-2.0
/**
 * 「点一下 → 等结果 → 回填」面板的统一中止能力（T04-d）。
 *
 * 这些面板的请求在服务端已经会因为**客户端断开**而停下（后端侧套了
 * `run_until_disconnect` / `run_or_gone`），缺的只是界面上的那颗「停止」。
 * 本 hook 提供三件事，避免十个面板各写一套：
 *
 * 1. **一个 signal**：`run(task)` 把 `AbortSignal` 交给调用方，由它传给 `request()`；
 * 2. **可再点**：`cancel()` 立刻把 `loading` 收起（不等 Promise 落地——挂着的请求可能
 *    永远不 resolve，例如测试替身或代理把连接冻住），面板当场回到"可以再点"；
 * 3. **取消不是失败**：`run` 不抛错，而是返回带 `status` 的三态结果。`aborted` 与
 *    `error` 分开，调用方因此不可能把"用户自己停的"当失败弹提示。
 *
 * ## abort 的判定口径（与仓库既有实现一致，不另立一套）
 *
 * - `isCancellation(error)`：`request()` 把"调用方中止"翻译成 `ApiError(code="cancelled")`
 *   （见 `api/apiError.ts`），这是绝大多数面板的路径；
 * - `name === "AbortError"`：流式端点（SSE）直接用原生 `fetch`，抛的是 DOMException，
 *   口径与 `features/interview/useInterviewTurn.ts` 的 `isAborted()` 相同；
 * - `signal.aborted`：最可靠的兜底——只要是我们自己断开的，就不该展示成错误，哪怕
 *   调用方在 promise 落地前把它包成了别的错误类型。
 *
 * 三者只要命中一条即判定为"取消"。
 *
 * ## 卸载
 *
 * 组件卸载（离开页面、关弹窗）与"点停止"在语义上都是 abort，不做区分：两者都只表示
 * "我不等了"。卸载后会跳过所有 setState，避免在已卸载的组件上写状态。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isCancellation } from "../api/client";

/** 一次可中止任务的结果：成功 / 用户取消 / 真实失败，三者互斥。 */
export type AbortableOutcome<T> =
  { status: "ok"; data: T } | { status: "aborted" } | { status: "error"; error: unknown };

/**
 * 这个错误是不是"用户自己按了停止"。
 *
 * 三个来源都要认（见文件头）：`ApiError(code="cancelled")`、原生 `AbortError`，
 * 以及调用方声明的 signal 已被中止。传 `signal` 时判定最准，但省略也能工作。
 */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (isCancellation(error)) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

export interface AbortableRequest {
  /**
   * 跑一次任务，把 `signal` 交给 `task`。
   *
   * 同一时刻只跑一个：上一个还没落地就先断开它的连接（否则两个结果会互相覆盖）。
   * 不抛错——成功、取消、失败都从返回值读。
   */
  run: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<AbortableOutcome<T>>;
  /** 停止：断开在跑的请求，`loading` 立刻收起。没在跑时是空操作。 */
  cancel: () => void;
  /** 有任务在跑（面板据此显示「停止」与既有 loading 态）。 */
  loading: boolean;
  /** 最近一次 `run` 是被用户（或卸载）中止的。下一次 `run` 开始时复位。 */
  aborted: boolean;
}

export function useAbortableRequest(): AbortableRequest {
  const [loading, setLoading] = useState(false);
  const [aborted, setAborted] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // 卸载后不再 setState：请求的收尾回调可能比组件活得久。
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // 卸载 = 不等了：断开连接，服务端随之停下（不再继续烧 token）。
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.abort();
    // **同步**收起 loading：不等 promise 落地，面板当场回到可再点。
    if (aliveRef.current) {
      setAborted(true);
      setLoading(false);
    }
  }, []);

  const run = useCallback(
    async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<AbortableOutcome<T>> => {
      // 重入：先把上一次的连接断掉，保证"最后一次点击说了算"。
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (aliveRef.current) {
        setAborted(false);
        setLoading(true);
      }
      try {
        const data = await task(controller.signal);
        // 请求在落地前被停掉：不把"半截结果"交回去。
        if (controller.signal.aborted) return { status: "aborted" };
        return { status: "ok", data };
      } catch (error) {
        if (isAbortError(error, controller.signal)) return { status: "aborted" };
        return { status: "error", error };
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        // 被中止时 `loading` 已由 cancel/下一次 run 接管，这里不再抢着改。
        if (aliveRef.current && !controller.signal.aborted) setLoading(false);
      }
    },
    [],
  );

  return { run, cancel, loading, aborted };
}

/**
 * 面板里那句「失败提示」的取法：优先用错误自带的 message，否则回落到调用方给的文案。
 *
 * 放在这里是因为十个面板都要这一句，各写一遍迟早会有一处忘记判空。
 */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default useAbortableRequest;
