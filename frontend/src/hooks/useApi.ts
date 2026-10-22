// SPDX-License-Identifier: Apache-2.0
/** 通用数据加载 Hook：管理 loading / error / data 三态。 */
import { DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { isCancellation } from "../api/client";
import { useDependencyVersion } from "./useDependencyVersion";

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

export function useApi<T>(fetcher: ApiFetcher<T>, deps: DependencyList = []): ApiState<T> {
  const dependencyVersion = useDependencyVersion(deps);
  const activeDependencyVersion = useRef(dependencyVersion);
  const [data, setDataState] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  // 当前 in-flight 请求的中止器：reload 或卸载时中止被替换的旧请求（RF-07）。
  const abortRef = useRef<AbortController | null>(null);

  // 始终调用最新传入的 fetcher；deps 仅控制「何时刷新」。
  // ref 写入放 effect（Compiler 规则禁止渲染期写 ref）：本 effect 声明在
  // reload effect 之前，同一轮提交里先更新 ref 再触发重载，取到的是新 fetcher。
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
    activeDependencyVersion.current = dependencyVersion;
  });

  const reload = useCallback(async () => {
    if (dependencyVersion !== activeDependencyVersion.current) return;
    const currentRequest = ++requestVersion.current;
    // 版本守卫基础上对被替换的旧请求 abort()：慢请求不再占用连接、也不会迟到覆盖。
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await fetcherRef.current(controller.signal);
      if (currentRequest === requestVersion.current) setDataState(result);
    } catch (err) {
      // 取消（被新请求替换 / 卸载导致的中止）不进错误态：只有最新请求的真实失败才展示。
      if (currentRequest === requestVersion.current && !isCancellation(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  }, [dependencyVersion]);

  useEffect(() => {
    void reload();
    return () => {
      requestVersion.current += 1;
      abortRef.current?.abort();
    };
  }, [reload]);

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
