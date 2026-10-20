// SPDX-License-Identifier: Apache-2.0
/**
 * 版式重排的**尾随合并**（项 6 / D11）。
 *
 * 拖动滑块时用户产生的是"中间态"：中间态全部渲染一遍既慢又毫无意义（0.05 的差别人眼
 * 看不出来）。这里的语义是"**永远只渲染用户最后停住的那一版**"：
 *
 * 1. **空闲**：`request(a)` 立刻发起一次渲染（`relayouting = true`）。
 * 2. **在飞**：后续的 `request(b)` / `request(c)` **不发请求**，只覆盖"待渲染"的那一版
 *    （后到的覆盖先到的）；当前这次渲染完成后，若还有待渲染的，取它再跑一次。
 *    → 任意长度的一次拖动**最多 2 次请求**，参数序列是 `[首个, 最后一个]`。
 * 3. **失败**：`onError` 汇报、`relayouting` 归位、**丢弃待渲染的那一版、不自动重试**
 *    （失败 → 重试 → 再失败会变成死循环，用户看到的是"请求一直打"）。
 * 4. **卸载后**：不 setState、不调 `onRendered`（否则父组件会收到"已卸载组件的回调"）。
 *
 * 纯前端编排：**不 import 任何 api**。怎么渲染（PATCH 还是只重渲染）由宿主决定，
 * 两个宿主的失败后果不一样（`ResumeDetailModal` 不落库、`GenerateResumeModal` 要写回记录）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeLayout } from "../../types";

interface Options {
  /** 真正干活的渲染。参数是"这一版"版式；抛错则走 `onError`。 */
  render: (next: ResumeLayout) => Promise<void>;
  /** 渲染成功：宿主在这里把本地草稿推进到 `next`（见两个宿主的 `setLayout`）。 */
  onRendered?: (next: ResumeLayout) => void;
  /** 渲染失败：宿主负责提示与清理（例如清掉本地探针）。**不会**自动重试。 */
  onError?: (error: unknown, next: ResumeLayout) => void;
}

interface Result {
  /** 是否有一次渲染在飞（用于"正在按新版式渲染…"文案与防重复提交）。 */
  relayouting: boolean;
  /** 请求渲染这一版版式：空闲即发，在飞则合并到"最后那一版"。 */
  request: (next: ResumeLayout) => void;
}

export function useResumeRelayout({ render, onRendered, onError }: Options): Result {
  const [relayouting, setRelayouting] = useState(false);
  /** 卸载守卫：置 false 之后一律不 setState、不回调。 */
  const aliveRef = useRef(true);
  /** 是否有一次渲染在飞（同步可用，不经过 state）。 */
  const inFlightRef = useRef(false);
  /** 待渲染的那一版（**只保留最新**，这就是"尾随"）。 */
  const pendingRef = useRef<ResumeLayout | null>(null);
  /**
   * 回调走 ref：`render` / `onRendered` / `onError` 通常是父组件的内联函数，每次渲染都是
   * 新引用；放进依赖会让 `request` 的身份不停变（拖动的每一帧都换一个新函数）。
   * ref 的写入放 effect —— Compiler 不允许渲染期写 ref。
   */
  const latestRef = useRef({ render, onRendered, onError });
  useEffect(() => {
    latestRef.current = { render, onRendered, onError };
  });

  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  /**
   * 跑一次渲染并收尾。
   *
   * 用具名函数表达式（`async function run`）而不是 `const run = async () => {}`：
   * 收尾时要**递归调用自己**，箭头函数在定义完成前引用自己会撞 TDZ。
   */
  const run = useCallback(async function run(next: ResumeLayout): Promise<void> {
    inFlightRef.current = true;
    if (aliveRef.current) setRelayouting(true);
    try {
      await latestRef.current.render(next);
      if (aliveRef.current) latestRef.current.onRendered?.(next);
    } catch (error) {
      // 失败即丢弃待渲染的那一版：不自动重试（见文件头第 3 条）。
      pendingRef.current = null;
      if (aliveRef.current) latestRef.current.onError?.(error, next);
    } finally {
      // 先腾出"在飞"的位置，再决定"续跑最后一版"还是"收工"。
      inFlightRef.current = false;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (aliveRef.current && queued) {
        void run(queued);
      } else if (aliveRef.current) {
        setRelayouting(false);
      }
    }
  }, []);

  const request = useCallback(
    (next: ResumeLayout) => {
      if (inFlightRef.current) {
        // 在飞：只记下最新那一版，不发请求。
        pendingRef.current = next;
        return;
      }
      void run(next);
    },
    [run],
  );

  return { relayouting, request };
}
