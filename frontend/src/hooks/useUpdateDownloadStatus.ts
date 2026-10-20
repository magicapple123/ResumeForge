// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { getUpdateDownloadStatus } from "../api/settings";
import type { UpdateStatus } from "../types";
import { isDocumentHidden, onVisibilityChange } from "../utils/visibility";

const POLL_MS = 800;

/** Status reads must never overwrite a newer download/install action result. */
export function useUpdateDownloadStatus() {
  const [status, setStatusState] = useState<UpdateStatus | null>(null);
  const [statusError, setStatusError] = useState("");
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
        if (isCurrent()) setStatusError("暂时无法读取下载状态，请重试读取后再下载或安装");
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
