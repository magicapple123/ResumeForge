import { useCallback, useState } from "react";
import {
  clearWebFormSession,
  loadWebFormSession,
  saveWebFormSession,
  type WebFormSessionState,
} from "./webFormSessionStorage";

/**
 * 网申页的临时会话只留在当前应用标签页。
 *
 * 浏览器状态由后端实时探测，表单快照/勾选/手改值由这里保留；两者分开，
 * 这样浏览器真的关掉时仍会显示 stopped，但用户没有点「结束」前不会丢草稿。
 */
export function useWebFormSession() {
  const [initial] = useState(loadWebFormSession);
  const persist = useCallback((state: WebFormSessionState) => {
    saveWebFormSession(state);
  }, []);
  const clear = useCallback(() => {
    clearWebFormSession();
  }, []);
  return { initial, persist, clear };
}
