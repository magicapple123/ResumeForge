// SPDX-License-Identifier: Apache-2.0
/** 今日简报的取数与「重新生成」（18B）。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getAssistantDigest, refreshAssistantDigest, type AssistantDigest } from "./digestApi";

export interface AssistantDigestController {
  digest: AssistantDigest | null;
  loading: boolean;
  refreshing: boolean;
  /** 失败标记（不是文案）：错误提示由卡片用 t() 渲染，hook 里不放用户可见字符串。 */
  failed: boolean;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * `enabled=false`（浮窗/紧凑模式）时不请求也不轮询：简报只在助手主页面出现。
 * 请求序号守卫与任务条同一纪律：慢响应不得覆盖新状态。
 */
export function useAssistantDigest(enabled: boolean = true): AssistantDigestController {
  const [digest, setDigest] = useState<AssistantDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);

  const load = useCallback(async (force: boolean) => {
    const seq = ++seqRef.current;
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const payload = force ? await refreshAssistantDigest() : await getAssistantDigest();
      if (seq !== seqRef.current) return;
      setDigest(payload);
      setFailed(false);
    } catch {
      if (seq !== seqRef.current) return;
      setFailed(true);
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    seqRef.current += 1;
    if (!enabled) {
      setLoading(false);
      return;
    }
    void load(false);
    return () => {
      seqRef.current += 1;
    };
  }, [enabled, load]);

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);
  return { digest, loading, refreshing, failed, reload, refresh };
}
