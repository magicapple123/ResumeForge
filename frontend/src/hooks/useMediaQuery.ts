// SPDX-License-Identifier: Apache-2.0
import { useCallback, useSyncExternalStore } from "react";

/**
 * 订阅一条媒体查询。
 *
 * 用 `useSyncExternalStore` 而不是 `useState + useEffect`：媒体查询是典型的"外部状态源"，
 * 首帧必须**同步**读到真值，否则侧栏会先按展开态渲染一帧、再跳成折叠态（宽度闪一下）。
 * 同一条路径也免掉了在 effect 里 setState 触发的 `react-hooks/set-state-in-effect` 告警。
 *
 * jsdom 兜底 false：测试环境的 `matchMedia` 桩恒返回 `matches: false`，等价于"宽屏、
 * 侧栏展开"——这正是既有用例的前提，所以不需要为测试改断言。
 */
function isAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!isAvailable()) return () => undefined;
      const list = window.matchMedia(query);
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }
      // Safari 13 只有已废弃的 addListener；多两行就能免掉"某台机器上折不开"。
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => (isAvailable() ? window.matchMedia(query).matches : false),
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
