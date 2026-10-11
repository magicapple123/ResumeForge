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
 *
 * ``datasetId``（RF-13）：草稿按数据集隔离——切换数据集是整页 reload，恢复与
 * 持久化都必须落在同一个 key 上，所以调用方在挂载时取一次并传进来。
 */
export function useWebFormSession(datasetId: string) {
  // 挂载时定死作用域：本页生命周期内数据集不会变（切换 = 整页 reload）。
  const [initial] = useState(() => loadWebFormSession(datasetId));
  const persist = useCallback(
    (state: WebFormSessionState) => {
      saveWebFormSession(state, datasetId);
    },
    [datasetId],
  );
  const clear = useCallback(() => {
    clearWebFormSession(datasetId);
  }, [datasetId]);
  return { initial, persist, clear };
}
