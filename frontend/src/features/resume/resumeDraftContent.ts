// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台「中栏改内容 → 右栏实时预览」的**单向**通道（P0-7）。
 *
 * 为什么是"外部 store"而不是一个 state 或 context：
 *
 * 1. **不回灌**。中栏的表单是唯一编辑源，它把「合并后的草稿内容」写进这个 store；
 *    右栏订阅它。`content` prop 永远只喂服务端那一份——一旦让草稿沿着 props 回传成
 *    `content`，`useResumeEditorPanel` 的"内容签名变了就重填表单"守卫会命中，
 *    用户每打一个字就被服务端那份覆盖一次（数据丢失，设计 §7 R1）。
 * 2. **只让画布重渲染**。订阅点在 `ResumeWorkbenchLiveCanvas` 这个薄壳里；store 是普通
 *    对象，不参与三栏的 React 状态，所以每键输入只重渲染画布子树（设计 §7 R3）。
 * 3. **可单测**。节流 + 签名去重是纯逻辑，不需要渲染 React 就能钉住。
 *
 * 三条契约（`useSyncExternalStore` 要求）：
 *
 * - `subscribe` 返回的取消函数必须幂等；
 * - `getSnapshot` 在两次通知之间必须返回**同一个引用**（否则 React 会判定"每帧都在变"）；
 * - 通知只能发生在 state 真的变了之后（同一份内容重复 `set` 不通知）。
 */
import type { ResumeContent } from "../../types";

/** 默认节流窗口：连续输入时每 ~150ms 最多通知一次，尾随（取窗口内最后一次的值）。 */
export const DRAFT_FLUSH_MS = 150;

export interface ResumeDraftStore {
  /**
   * 上报一版草稿内容。
   *
   * `signature` 是内容签名（调用方用 `contentSignature(content)` 算好传进来）：与**上一次
   * 上报**相同就直接丢弃——一次输入里 `history.push` 引起的重复上报不会造成二次渲染。
   */
  set(content: ResumeContent, signature: string): void;
  /** 丢掉草稿：预览回落到宿主那一版 html（保存成功 / 放弃修改 / 内容重填三处调用）。 */
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** `useSyncExternalStore` 的快照：没有草稿时固定返回 `null`。 */
  getSnapshot(): ResumeContent | null;
}

/**
 * 造一个草稿 store。
 *
 * `flushMs` 只给测试用（传 0 = 同步通知，断言不必和定时器赛跑）；生产一律用
 * `DRAFT_FLUSH_MS`，**不要**为了"更即时"把它调小——预览的实际延迟由
 * `useResumeLivePreview` 的 600ms 防抖决定，这里只负责别让一次输入里攒出多次通知。
 */
export function createResumeDraftStore(flushMs: number = DRAFT_FLUSH_MS): ResumeDraftStore {
  const listeners = new Set<() => void>();
  /** 已通知出去的那一版；`null` = 没有草稿（预览用宿主那一版）。 */
  let snapshot: ResumeContent | null = null;
  /** 还没通知出去的最新一版（节流窗口内的"最后一次"。 */
  let pending: ResumeContent | null = null;
  /** 最近一次被接受的上报签名（去重用；`clear` 后重置）。 */
  let pendingSignature = "";
  /** 已经通知出去的那一版签名（避免同一份内容通知两次）。 */
  let flushedSignature = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    // 复制一份再遍历：监听器在回调里取消订阅时不会打乱迭代。
    for (const listener of [...listeners]) listener();
  };

  const flush = () => {
    timer = null;
    if (pending === null) return;
    if (flushedSignature === pendingSignature) return;
    snapshot = pending;
    flushedSignature = pendingSignature;
    notify();
  };

  return {
    set(content: ResumeContent, signature: string) {
      // 同一份内容重复上报（一次输入里可能有多次）：什么都不做，连定时器都不重排。
      if (signature === pendingSignature) return;
      pending = content;
      pendingSignature = signature;
      if (flushMs <= 0) {
        flush();
        return;
      }
      // 尾随节流：窗口内只排一次，值取窗口内最后一次（上面对 `pending` 的覆盖就是"取最后一次"）。
      if (timer === null) timer = setTimeout(flush, flushMs);
    },
    clear() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      pendingSignature = "";
      if (snapshot === null) return;
      snapshot = null;
      flushedSignature = "";
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
  };
}
