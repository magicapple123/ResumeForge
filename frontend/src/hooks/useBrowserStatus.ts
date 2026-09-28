/** 受控浏览器状态：首屏读取、自动轮询与手动刷新共用。 */
import { useEffect } from "react";
import { useApi } from "./useApi";
import type { BrowserStatus } from "../types";

const DEFAULT_POLL_INTERVAL_MS = 1500;

export function useBrowserStatus(
  fetchStatus: () => Promise<BrowserStatus>,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
) {
  const state = useApi<BrowserStatus>(fetchStatus, []);
  const { reload } = state;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    /**
     * **先等这一次问完，再排下一次**——不要用固定间隔的 `setInterval`。
     *
     * 固定间隔 + 慢接口会让 `useApi` 里那个防乱序的版本号守卫**丢掉每一个响应**：
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
    };
  }, [pollIntervalMs, reload]);

  return state;
}
