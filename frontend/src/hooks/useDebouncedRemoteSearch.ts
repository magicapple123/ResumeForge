// SPDX-License-Identifier: Apache-2.0
/**
 * 远程搜索下拉的内核：防抖 + 请求序号 + 加载态（T29 收敛，模块原为 T13 的两份拷贝）。
 *
 * 两个下拉都用它：
 *
 * - `useRemoteSearchSelect`（单端点的岗位 / 简历 / 进度）；
 * - `useResumeRefSelect`（内部 + 外部简历**并行**查两端、分组输出）。
 *
 * 之所以抽出来：T13 给「关联简历」写统一选择器时，把防抖、序号比对、loading 与空态
 * 文案整段复制了一遍。两份实现的分歧不会报错，只会表现为"某个下拉偶尔停在旧结果上"
 * ——这类 bug 靠肉眼几乎发现不了，所以只留一份。
 *
 * 三条约定（沿用 `useRemoteSearchSelect` 的既有做法）：
 *
 * 1. **防抖 300ms**：输入过程中只重置计时器，停手才发请求；
 * 2. **竞态用请求序号**，不用 AbortController（项目禁用 `AbortSignal.any`；单请求无需
 *    abort，序号比对同样保证只采纳最后一次结果）。**过期响应连 loading 都不关**：
 *    正在跑的那一条才是"最新的"，让旧响应关掉 loading 会让下拉先空一下再装满；
 * 3. **卸载时清计时器**：否则对已卸载组件 setState。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";

/** 默认防抖毫秒数（两个下拉共用，改这里就是改全站）。 */
export const DEFAULT_DEBOUNCE_MS = 300;

export interface DebouncedRemoteSearch {
  /** 当前是否有请求在飞（antd `Select` 的 `loading`）。 */
  loading: boolean;
  /**
   * 开一次请求：`++序号` + 置 loading，返回本次的序号。
   *
   * 调用方拿到序号后在响应落地时用 :func:`isCurrent` 判断该不该采纳。
   */
  begin: () => number;
  /** 本次响应还是最新的吗（过期响应直接丢弃，连 loading 都不关）。 */
  isCurrent: (requestId: number) => boolean;
  /** 关闭 loading（只有最新那次响应可以调）。 */
  settle: () => void;
  /** 输入变化：重置计时器，停 `debounceMs` 后执行 `run(去掉首尾空白的词)`。 */
  schedule: (keyword: string, run: (keyword: string) => void) => void;
  /** 立刻清掉待触发的计时器（卸载时自动调一次）。 */
  cancelPending: () => void;
}

export function useDebouncedRemoteSearch(
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): DebouncedRemoteSearch {
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 卸载时清掉还没触发的防抖计时器，避免对已卸载组件 setState。
  useEffect(() => cancelPending, [cancelPending]);

  const begin = useCallback(() => {
    requestSeqRef.current += 1;
    setLoading(true);
    return requestSeqRef.current;
  }, []);

  const isCurrent = useCallback((requestId: number) => requestId === requestSeqRef.current, []);

  const settle = useCallback(() => setLoading(false), []);

  const schedule = useCallback(
    (keyword: string, run: (keyword: string) => void) => {
      cancelPending();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        run(keyword.trim());
      }, debounceMs);
    },
    [cancelPending, debounceMs],
  );

  return { loading, begin, isCurrent, settle, schedule, cancelPending };
}

/**
 * 下拉"没有匹配项"的文案（渲染期调用，调用方必须已 `useLocale()` 订阅语言）。
 *
 * 放在内核里是因为两个下拉的空态必须一模一样：一个说「搜索中…」一个说「加载中」，
 * 用户会以为它们不是同一个功能。
 */
export function remoteSearchEmptyText(loading: boolean): string {
  return loading ? t("hooksUi.remoteSearch.searching") : t("hooksUi.remoteSearch.empty");
}
