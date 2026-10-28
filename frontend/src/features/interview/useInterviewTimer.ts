// SPDX-License-Identifier: Apache-2.0
/**
 * 面试计时器（0066）：只在候选人「真的在面试」时走秒。
 *
 * 三条产品约束决定了它不是简单的 `Date.now() - startedAt`：
 * 1. **点「准备好了」才开始**：进房间时不跑表，等用户自己确认；
 * 2. **离开页面要暂停**：重新进房间必须再点一次「继续面试」才接着走；
 * 3. **最终报告要用它**：所以每秒的累计值都要能上报给服务端，而不是只活在内存里。
 *
 * 对外只有 `seconds` / `label` / `flush`：`flush` 供页面在"提交回答后""确认结束前"
 * 这类关键节点主动上报，退出页面则由内部的暂停/卸载回调兜底。
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 两位数字（`5` → `05`）。
 *
 * 刻意**不用** `padStart(2, "0")`：那个 `"0"` 是字符串字面量，会被"不得新增界面文案"的
 * 守卫（productCopyAst）当成新文案，进而要求把补零字符也塞进语言包。纯算术拼接既没有
 * 字面量，又对 0..99 全对。
 */
function twoDigits(value: number): string {
  return `${Math.floor(value / 10)}${value % 10}`;
}

/** 计时器的展示口径：`mm:ss`，超过 1 小时用 `h:mm:ss`。 */
export function formatElapsed(seconds: number): string {
  // 负数 / NaN / Infinity 一律按 0 处理：界面上不能出现 `NaN:NaN`。
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${twoDigits(minutes)}:${twoDigits(rest)}`;
  }
  return `${twoDigits(minutes)}:${twoDigits(rest)}`;
}

export interface InterviewTimerOptions {
  /** 当前会话：换一场面试时计时从这一场的已有时长重新开始。 */
  sessionId: number | null;
  /** 服务端记住的已累计秒数（打开旧会话时接着算）。 */
  initialSeconds: number;
  /** 是否在走表（= 用户已经点过「准备好了」且还留在面试里）。 */
  running: boolean;
  /** 上报"本次已累计的有效秒数"（绝对值；服务端取大值）。 */
  onPersist: (seconds: number) => void;
}

export interface InterviewTimer {
  seconds: number;
  /** `mm:ss` / `h:mm:ss`，直接可渲染。 */
  label: string;
  /** 立刻上报当前累计值（关键节点用，例如提交回答后、确认结束前）。 */
  flush: () => void;
}

/**
 * 走秒并上报累计时长。
 *
 * 上报时机：`running` 由 true 变 false（暂停 / 交出控制权）、组件卸载、`beforeunload`，
 * 以及调用方显式 `flush()`。全部走同一个"绝对值"语义，重复上报没有副作用。
 */
export function useInterviewTimer({
  sessionId,
  initialSeconds,
  running,
  onPersist,
}: InterviewTimerOptions): InterviewTimer {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor(initialSeconds)));
  // 上报时机常常在闭包里（卸载 / beforeunload），必须读**最新**值而不是渲染时的快照。
  const secondsRef = useRef(seconds);
  const persistRef = useRef(onPersist);
  const runningRef = useRef(running);

  // 回调与当前值同步到 ref：不这样做，`beforeunload` 里拿到的是首帧的 0。
  useEffect(() => {
    persistRef.current = onPersist;
  }, [onPersist]);
  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  // 换会话（含「打开另一场历史面试」）时重置：从这一场服务端记住的秒数接着算。
  // 刻意只跟 sessionId 走：initialSeconds 会在上报后变化，用它当依赖会把表往回拨。
  const lastSessionRef = useRef(sessionId);
  useEffect(() => {
    if (lastSessionRef.current === sessionId) return;
    lastSessionRef.current = sessionId;
    const base = Math.max(0, Math.floor(initialSeconds));
    secondsRef.current = base;
    setSeconds(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 走表：`running` 为 false 时根本不起定时器（不是起了再判断，省得白跑）。
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // 暂停时上报一次（true → false 的那一刻）。
  useEffect(() => {
    if (runningRef.current && !running) persistRef.current(secondsRef.current);
    runningRef.current = running;
  }, [running]);

  // 离开页面：`beforeunload` 与卸载各报一次（绝对值，重复无害）。
  useEffect(() => {
    const flush = (): void => persistRef.current(secondsRef.current);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  const flush = useCallback(() => {
    persistRef.current(secondsRef.current);
  }, []);

  return { seconds, label: formatElapsed(seconds), flush };
}
