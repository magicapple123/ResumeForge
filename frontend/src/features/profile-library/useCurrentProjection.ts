// SPDX-License-Identifier: Apache-2.0
/**
 * 当前组投影的消费者 hook（F4）：wanted 时从共享缓存取一次，暴露 data/loading/error/reload。
 *
 * 语义（契约 §5.1）：
 * - 失败**可重试**：错误只进 state，不缓存成"没有数据"；reload() 重新发起。
 * - 失效自动重取：资料保存/切组/导入等让 projectionCache 失效后，已挂载的面板自动重取。
 * - 迟到响应丢弃：请求序号 + 缓存键双重校验（切组窗口不把旧组数据当新组）。
 * - 卸载/不再需要时取消：最后一个消费者退出才真正中止请求，共享请求不被单个 hook 打断。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCachedProjection,
  projectionCacheKey,
  requestProjection,
  subscribeProjectionInvalidation,
} from "./projectionCache";
import type { PaperProjectionOut } from "./types";

export interface CurrentProjectionApi {
  data: PaperProjectionOut | null;
  loading: boolean;
  error: Error | null;
  /** 手动重试（失败后的入口）；会丢弃上一代结果。 */
  reload: () => void;
}

export function useCurrentProjection(wanted: boolean): CurrentProjectionApi {
  const [data, setData] = useState<PaperProjectionOut | null>(
    () => getCachedProjection()?.data ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const sequence = useRef(0);

  const load = useCallback(() => {
    const seq = ++sequence.current;
    const apply = (next: PaperProjectionOut): void => {
      if (seq !== sequence.current) return;
      setData(next);
      setLoading(false);
      setError(null);
    };
    if (getCachedProjection() !== null) {
      apply(getCachedProjection()!.data);
      return;
    }
    setLoading(true);
    setError(null);
    const request = requestProjection();
    request.promise.then(
      (next) => {
        if (seq !== sequence.current) return;
        if (request.key !== projectionCacheKey()) return; // 已失效：等 invalidation 通知再取
        apply(next);
      },
      (reason: unknown) => {
        if (seq !== sequence.current) return;
        setLoading(false);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    const cancel = request.cancel;
    return () => {
      sequence.current += 1;
      cancel();
    };
  }, []);

  useEffect(() => {
    if (!wanted) return;
    // 首次加载必须同步进入 loading 态（否则面板会先闪一帧"没有资料"再变成加载中）；
    // 之后的失效重取由订阅回调触发，不在 effect 里。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    return load();
  }, [load, wanted]);

  useEffect(() => {
    if (!wanted) return;
    return subscribeProjectionInvalidation(() => load());
  }, [load, wanted]);

  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  const reload = useCallback(() => {
    sequence.current += 1;
    load();
  }, [load]);

  return { data, loading, error, reload };
}
