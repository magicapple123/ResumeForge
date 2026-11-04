// SPDX-License-Identifier: Apache-2.0
/** 通用数据加载 Hook：管理 loading / error / data 三态。 */
import { DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { isCancellation } from "../api/client";
import { useDependencyVersion } from "./useDependencyVersion";
import { isPageVisible, subscribeFocusRefresh } from "./focusRefresh";

/**
 * fetcher 可选地接收一个 AbortSignal：被新请求替换或组件卸载时会被中止，让底层
 * request() 及时释放连接。老的 `() => Promise<T>` 形态的 fetcher 完全兼容（参数变可选，
 * 忽略 signal 时仅靠版本守卫防旧结果覆盖）。
 */
export type ApiFetcher<T> = (signal?: AbortSignal) => Promise<T>;

interface ApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/** 回到前台重拉的默认最小间隔：来回切窗口不该每次都打一轮请求。 */
export const DEFAULT_FOCUS_REFETCH_MS = 30_000;

/** `refetchOnFocus` 的行为开关。 */
export interface FocusRefetchOptions {
  /** 距上次成功拉取至少隔多久才重拉，默认 30s。 */
  minIntervalMs?: number;
  /** 返回 true 时跳过本次重拉（例如页面有未保存草稿，不能被覆盖）。 */
  skip?: () => boolean;
}

/**
 * `useApi` 的可选行为开关（第三个参数）。
 *
 * 用**同一个对象**承载所有开关而不是加位置参数：调用点只关心自己那一项，后续新增开关
 * 不会把已有调用点挤成 `useApi(fn, deps, undefined, true)` 这种看不懂的形状。
 */
export interface UseApiOptions {
  /**
   * 是否在挂载与 deps 变化时自动请求，默认 `true`。
   *
   * `false` 时不自动发请求、`loading` 初值为 `false`（否则首屏会挂一个永不结束的骨架），
   * 只有手动调用 `reload()` 才发请求——用于"必须先有用户输入才能查"的面板。
   */
  enabled?: boolean;
  /**
   * 窗口回到前台时静默重拉。不传就完全不受 focus 影响（默认不开启：只给几个列表页开，
   * 验证一轮再考虑扩大）。
   *
   * 三条同时满足才拉：页面可见（模块层判断）、距上次成功 ≥ `minIntervalMs`、`skip()` 为假。
   * 静默 = 不置 `loading`、失败不进 `error`（保留旧数据），所以不会闪骨架屏、不会把页面
   * 打成错误态。
   */
  refetchOnFocus?: FocusRefetchOptions;
}

export function useApi<T>(
  fetcher: ApiFetcher<T>,
  deps: DependencyList = [],
  options: UseApiOptions = {},
): ApiState<T> {
  const { enabled = true, refetchOnFocus } = options;
  const dependencyVersion = useDependencyVersion(deps);
  const activeDependencyVersion = useRef(dependencyVersion);
  const [data, setDataState] = useState<T>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  // 当前 in-flight 请求的中止器：reload 或卸载时中止被替换的旧请求（RF-07）。
  const abortRef = useRef<AbortController | null>(null);
  // 最近一次**成功**拉取的时间：focus 重拉的冷却起点（不是发起时间，失败不该重置冷却）。
  const lastSuccessAt = useRef(0);
  // 静默重拉不能叠加：已经有一个请求在飞时直接跳过，否则一次切窗发两次请求。
  const inFlight = useRef<AbortController | null>(null);

  // 始终调用最新传入的 fetcher；deps 仅控制「何时刷新」。
  // ref 写入放 effect（Compiler 规则禁止渲染期写 ref）：本 effect 声明在
  // reload effect 之前，同一轮提交里先更新 ref 再触发重载，取到的是新 fetcher。
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
    activeDependencyVersion.current = dependencyVersion;
  });

  const run = useCallback(
    async (silent: boolean) => {
      if (dependencyVersion !== activeDependencyVersion.current) return;
      // 在飞请求不叠加：静默重拉遇到未结束的请求直接放弃（它结束后自会写回最新数据）。
      if (silent && inFlight.current) return;
      const currentRequest = ++requestVersion.current;
      // 版本守卫基础上对被替换的旧请求 abort()：慢请求不再占用连接、也不会迟到覆盖。
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlight.current = controller;
      if (!silent) {
        setLoading(true);
        setError("");
      }
      try {
        const result = await fetcherRef.current(controller.signal);
        if (currentRequest === requestVersion.current) {
          setDataState(result);
          setError("");
          lastSuccessAt.current = Date.now();
        }
      } catch (err) {
        // 取消（被新请求替换 / 卸载导致的中止）不进错误态：只有最新请求的真实失败才展示。
        if (currentRequest === requestVersion.current && !isCancellation(err)) {
          if (silent) {
            // 静默失败保持旧数据与页面状态，只留一条调试日志（验收：断网切回不崩）。
            if (import.meta.env.DEV) {
              console.debug("[useApi] focus refetch failed; keeping cached data", err);
            }
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
        if (currentRequest === requestVersion.current && !silent) setLoading(false);
      }
    },
    [dependencyVersion],
  );

  const reload = useCallback(() => run(false), [run]);

  useEffect(() => {
    // `enabled: false` 时只是**不自动发请求**；卸载清理照常注册——否则手动 reload 发出的
    // 请求会在卸载后继续跑（RF-07 的中止语义不能被这个开关顺手关掉）。
    if (enabled) void reload();
    return () => {
      requestVersion.current += 1;
      abortRef.current?.abort();
    };
  }, [enabled, reload]);

  // focus 重拉：对象可能每次渲染都是新的字面量，所以只按「有没有开」订阅，开关值走 ref。
  // 否则每次渲染都退订/重订一次，白折腾。
  const focusOptionsRef = useRef(refetchOnFocus);
  useEffect(() => {
    focusOptionsRef.current = refetchOnFocus;
  });
  const focusEnabled = Boolean(refetchOnFocus);
  useEffect(() => {
    if (!focusEnabled) return undefined;
    return subscribeFocusRefresh(() => {
      const focusOptions = focusOptionsRef.current;
      if (!focusOptions || !enabled) return;
      if (!isPageVisible()) return;
      if (focusOptions.skip?.()) return;
      const minIntervalMs = focusOptions.minIntervalMs ?? DEFAULT_FOCUS_REFETCH_MS;
      // `lastSuccessAt` 为 0（从没成功过，例如首屏失败/断网）时允许补拉。
      if (lastSuccessAt.current !== 0 && Date.now() - lastSuccessAt.current < minIntervalMs) return;
      void run(true);
    });
  }, [focusEnabled, enabled, run]);

  return {
    data,
    loading,
    error,
    reload,
    setData: (updater) =>
      setDataState((prev) =>
        typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater,
      ),
  };
}
