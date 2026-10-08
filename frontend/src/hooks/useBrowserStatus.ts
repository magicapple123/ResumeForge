/** 受控浏览器状态：首屏读取、自动轮询与手动刷新共用。 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserStatus } from "../types";

export const BROWSER_STATUS_POLL_INTERVAL_MS = 1500;

/**
 * 逐字段浅比较：轮询响应几乎总是「内容一字未变的新对象」。不比较就 setState 的
 * 话，每 600ms 一次的轮询会周期性触发两次整页重渲（loading 翻转 + 新对象落地），
 * 在用户打字时表现为规律性的输入卡顿。
 */
function browserStatusEqual(
  previous: BrowserStatus | undefined,
  next: BrowserStatus | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  const keysPrevious = Object.keys(previous) as (keyof BrowserStatus)[];
  const keysNext = Object.keys(next) as (keyof BrowserStatus)[];
  if (keysPrevious.length !== keysNext.length) return false;
  return keysPrevious.every((key) => previous[key] === next[key]);
}

interface BrowserStatusState {
  data: BrowserStatus | undefined;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  setData: (updater: BrowserStatus | ((prev: BrowserStatus | undefined) => BrowserStatus)) => void;
}

export function useBrowserStatus(
  fetchStatus: () => Promise<BrowserStatus>,
  pollIntervalMs = BROWSER_STATUS_POLL_INTERVAL_MS,
): BrowserStatusState {
  const [data, setDataState] = useState<BrowserStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 最近一次落地的响应：既是浅比较基准，也是「已有数据就不再闪加载态」的判据
  // （界面上 loading 只在还没有任何数据时展示，轮询期间翻 true/false 毫无可见收益）。
  const dataRef = useRef<BrowserStatus | undefined>(undefined);
  const requestVersion = useRef(0);

  // 始终调用最新传入的 fetcher（调用方常传内联箭头函数，不能直接进 useCallback 依赖）。
  const fetcherRef = useRef(fetchStatus);
  useEffect(() => {
    fetcherRef.current = fetchStatus;
  });

  const reload = useCallback(async () => {
    const currentRequest = ++requestVersion.current;
    if (!dataRef.current) setLoading(true);
    setError("");
    try {
      const result = await fetcherRef.current();
      if (currentRequest !== requestVersion.current) return;
      if (!browserStatusEqual(dataRef.current, result)) {
        dataRef.current = result;
        setDataState(result);
      }
    } catch (err) {
      if (currentRequest !== requestVersion.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  }, []);

  const setData = useCallback<BrowserStatusState["setData"]>((updater) => {
    setDataState((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      dataRef.current = next;
      return next;
    });
  }, []);

  // 首屏立即读取一次，随后进入自定步轮询（见下）——不能只靠轮询起步，
  // 否则首屏状态要等第一个间隔才落地，读取按钮会凭空晚 600ms 才可用。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 useApi 同款「挂载即首读」；setState 发生在 await 之后的微任务里，非同步级联
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    /**
     * **先等这一次问完，再排下一次**——不要用固定间隔的 `setInterval`。
     *
     * 固定间隔 + 慢接口会让防乱序的版本号守卫**丢掉每一个响应**：
     * 新请求总在旧响应回来之前发出，于是 `currentRequest !== requestVersion.current`
     * 永远成立，`setDataState` 与 `setLoading(false)` 一次都不执行。表现为
     * **状态永远停在初始值、加载图标一直转**，而且接口越慢越稳定复现。
     *
     * 这不是假想：浏览器状态接口实测耗时 **2.0s** 而间隔是 **1.5s**，正是这个形状
     * （见 `browser_manager._probe_ready` 的说明）。改成自定步之后，接口慢只会让
     * 刷新变疏，不会再让界面卡死在初始态。
     */
    const tick = async () => {
      if (cancelled) return;
      try {
        await reload();
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), pollIntervalMs);
      }
    };

    timer = window.setTimeout(() => void tick(), pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [pollIntervalMs, reload]);

  return { data, loading, error, reload, setData };
}
