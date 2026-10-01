/** 是否开启了系统级的「减弱动态效果」。 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * CSS 侧的动画由 `tou-tou-accessibility.css` 的媒体查询兜住；这个 hook 给的是
 * **JS 驱动**的小动作（比如发呆时的眨眼）用的同一条偏好——在 CSS 里关掉了动画、
 * 却让 JS 继续定时换表情，等于没关。
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(
    () => window.matchMedia?.(QUERY).matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const handleChange = () => setPrefersReduced(media.matches);
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, []);

  return prefersReduced;
}
