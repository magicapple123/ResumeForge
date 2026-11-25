// SPDX-License-Identifier: Apache-2.0
/**
 * 页面可见性工具：后台轮询共用（一处逻辑一份实现）。
 *
 * 标签页在后台时，秒级轮询纯属浪费——用户看不见进度，浏览器也会冻结定时器精度。
 * 但桌面版的卖点是"关窗口也继续跑，跑完告诉你"，所以在桌面壳里隐藏**不能**直接
 * 跳过轮询（CR-23）。统一口径：可见时按调用方自己的节奏，隐藏时降频，
 * 恢复可见立即补一轮。
 *
 * 注意：jsdom 里 `document.visibilityState` 恒为 "visible"，既有测试不受影响；
 * 需要模拟隐藏时在测试里覆写该属性并派发 `visibilitychange` 即可。
 */

/** 隐藏时的轮询间隔：AI / Agent 任务 10s（backgroundTasks 与 useAgentTasks 共用）。 */
export const HIDDEN_AI_POLL_MS = 10_000;

/** 隐藏时的轮询间隔：其它任务 15s（投递/采集批次）。 */
export const HIDDEN_BATCH_POLL_MS = 15_000;

/** 页面当前是否不可见（标签页在后台 / 窗口最小化）。 */
export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** 按当前可见性选择轮询间隔：隐藏时降频，可见时用调用方自己的节奏。 */
export function resolvePollInterval(visibleMs: number, hiddenMs: number): number {
  return isDocumentHidden() ? hiddenMs : visibleMs;
}

/** 监听可见性变化；返回退订函数。回调里通常配合 `isDocumentHidden()` 区分隐藏与恢复。 */
export function onVisibilityChange(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

export interface VisibilityPollingOptions {
  /** 可见时的轮询间隔（调用方自己的节奏）。 */
  visibleIntervalMs: number;
  /** 隐藏时的降频间隔。 */
  hiddenIntervalMs: number;
  /** 一轮轮询。返回 Promise 时等它结束再排下一轮，避免慢请求叠加。 */
  onTick: () => void | Promise<void>;
}

/**
 * 可见性感知的轮询循环（CR-23 的统一实现）。
 *
 * 与 `setInterval` 的区别：
 * - 隐藏时**不跳过**，而是把间隔换成 `hiddenIntervalMs`；
 * - 可见性切换时立刻重排当前等待（隐藏时把 1.5s 的节拍换成 15s，而不是等它先响一次）；
 * - 恢复可见时立即补一轮，再回到可见节奏；
 * - 用 `setTimeout` 串行排下一轮，慢请求不会产生并发轮询。
 *
 * @returns 停止函数（幂等）。
 */
export function startVisibilityPolling(options: VisibilityPollingOptions): () => void {
  const { visibleIntervalMs, hiddenIntervalMs, onTick } = options;
  let timer: number | null = null;
  let stopped = false;

  const runTick = () => {
    void Promise.resolve()
      .then(onTick)
      .catch(() => {
        /* 轮询点自己负责容错；这里只保证下一轮还能排上。 */
      })
      .finally(schedule);
  };

  function schedule(): void {
    if (stopped) return;
    timer = window.setTimeout(
      () => {
        timer = null;
        runTick();
      },
      resolvePollInterval(visibleIntervalMs, hiddenIntervalMs),
    );
  }

  function reschedule(): void {
    if (stopped) return;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    schedule();
  }

  const handleVisibilityChange = () => {
    if (stopped) return;
    if (isDocumentHidden()) {
      // 刚切到后台：用降频间隔重排，别让前台残留的短节拍再响一次。
      reschedule();
      return;
    }
    // 恢复可见：立即补一轮，并回到前台节奏。
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    runTick();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  schedule();

  return () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
}
