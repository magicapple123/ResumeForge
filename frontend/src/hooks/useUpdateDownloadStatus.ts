// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { getUpdateDownloadStatus } from "../api/settings";
import type { MessageKey } from "../i18n";
import type { UpdateStatus } from "../types";
import { isDocumentHidden, onVisibilityChange } from "../utils/visibility";

const POLL_MS = 800;

/**
 * 读取失败时的提示**只存 key，不存已求值的文案**：事件期取 t() 会把当时的语言冻进
 * state，切语言后这句提示就停在旧语种。语言在渲染期由消费方（UpdateCard）决定，
 * 它订阅了语言变化，所以切语言会重新渲染并重译。
 */
const STATUS_READ_ERROR_KEY: MessageKey = "hooksUi.updateStatus.error.read";

/** Status reads must never overwrite a newer download/install action result. */
export function useUpdateDownloadStatus() {
  const [status, setStatusState] = useState<UpdateStatus | null>(null);
  /** 空串表示"没有错误"；否则是待渲染期翻译的 key。 */
  const [statusError, setStatusError] = useState<MessageKey | "">("");
  const mounted = useRef(false);
  const version = useRef(0);
  const pending = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);

  const load = useCallback((replace = false): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    if (pending.current && !replace) return pending.current.promise;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const current = ++version.current;
    const isCurrent = () =>
      mounted.current && current === version.current && !controller.signal.aborted;
    const promise = Promise.resolve()
      .then(() => getUpdateDownloadStatus(controller.signal))
      .then((next) => {
        if (!isCurrent()) return;
        setStatusState(next);
        setStatusError("");
      })
      .catch(() => {
        if (isCurrent()) setStatusError(STATUS_READ_ERROR_KEY);
      })
      .finally(() => {
        if (pending.current?.controller === controller) pending.current = null;
      });
    pending.current = { controller, promise };
    return promise;
  }, []);

  const setStatus = useCallback((next: UpdateStatus) => {
    version.current += 1;
    pending.current?.controller.abort();
    pending.current = null;
    if (mounted.current) {
      setStatusState(next);
      setStatusError("");
    }
  }, []);

  // Event-path correction must supersede an old initial/poll read, not await its stale snapshot.
  const refreshStatus = useCallback(() => load(true), [load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      version.current += 1;
      pending.current?.controller.abort();
      pending.current = null;
    };
  }, [load]);

  const state = status?.state;
  useEffect(() => {
    if (state !== "downloading" && state !== "installing") return;
    let disposed = false;
    let running = false;
    let timer: number | undefined;
    const schedule = () => {
      if (!disposed) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    const tick = async () => {
      if (disposed) return;
      if (running || isDocumentHidden()) {
        schedule();
        return;
      }
      running = true;
      try {
        await load();
      } finally {
        running = false;
        schedule();
      }
    };
    const unsubscribe = onVisibilityChange(() => {
      if (disposed || running || isDocumentHidden()) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void tick();
    });
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [state, load]);

  return { status, statusError, setStatus, refreshStatus };
}
