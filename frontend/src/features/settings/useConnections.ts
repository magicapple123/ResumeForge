// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的取数钩子：一次拉整页快照，改完用响应直接替换本地副本。
 *
 * 为什么返回 `apply`：写接口（C 组）回的就是整页快照，"改完刷新状态"最省事的做法是
 * 把响应当新状态，而不是再发一次 GET——少一次往返，也不会出现列表里一条新、一条旧。
 *
 * 挂载加载用**内联 async IIFE**（与 `SearchCard` 同一条 Compiler 规范）：`setState`
 * 发生在回调里而不是 effect 体里，否则会触发级联渲染的告警。
 */

import { useCallback, useEffect, useState } from "react";
import { getConnections } from "../../api/connections";
import { t } from "../../i18n";
import type { ConnectionsPayload } from "../../types";

export interface UseConnectionsResult {
  data: ConnectionsPayload | null;
  loading: boolean;
  error: string;
  /** 重新取一次（失败时给「重试」用，也是各行的 `onChanged`）。 */
  reload: () => Promise<void>;
  /** 用一个刚拿到的整页快照替换本地状态。 */
  apply: (payload: ConnectionsPayload) => void;
}

export function useConnections(): UseConnectionsResult {
  const [data, setData] = useState<ConnectionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getConnections();
        if (cancelled) return;
        setData(payload);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("connections.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // 设置页切分组很频繁：卸载后晚到的响应不该再 setState。
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await getConnections());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connections.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  const apply = useCallback((payload: ConnectionsPayload): void => {
    setData(payload);
    setError("");
  }, []);

  return { data, loading, error, reload, apply };
}
