/** 通用数据加载 Hook：管理 loading / error / data 三态。 */
import { DependencyList, useCallback, useEffect, useRef, useState } from "react";

interface ApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList = []): ApiState<T> {
  const [data, setDataState] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 始终调用最新传入的 fetcher；deps 仅控制「何时重新加载」
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDataState(await fetcherRef.current());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖由调用方通过 deps 控制
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data,
    loading,
    error,
    reload,
    setData: (updater) =>
      setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater)),
  };
}
