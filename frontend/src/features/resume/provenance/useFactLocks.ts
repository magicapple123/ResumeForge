// SPDX-License-Identifier: Apache-2.0
/**
 * Fact-lock data layer for the source-chain panel: list / create / delete locks.
 * Split out of `./SourceChainPanelV2.tsx` to keep both files under the line budget;
 * pure move, no behaviour change.
 */
import { useCallback, useEffect, useState } from "react";
import { createFactLock, deleteFactLock, listFactLocks } from "./api";
import { pt } from "./i18n";
import type { FactLockCreateRequest, FactLockOut } from "./types";

interface Options {
  resumeId: number;
  disabled: boolean;
  revision: number | null;
}

export function useFactLocks({ resumeId, disabled, revision }: Options) {
  const [locks, setLocks] = useState<FactLockOut[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [lockSaving, setLockSaving] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const loadLocks = useCallback(async () => {
    if (!resumeId || disabled) return;
    setLocksLoading(true);
    try {
      const result = await listFactLocks(resumeId);
      setLocks(result.locks ?? []);
      setLockError(null);
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    } finally {
      setLocksLoading(false);
    }
  }, [disabled, resumeId]);

  useEffect(() => {
    // 取数入口的同步 setState 放进微任务，避开级联渲染告警（仍在本帧内发起请求）。
    queueMicrotask(() => void loadLocks());
  }, [loadLocks, revision]);

  const handleCreateLock = async (payload: FactLockCreateRequest) => {
    if (!resumeId) return;
    setLockSaving(true);
    try {
      await createFactLock(resumeId, payload);
      await loadLocks();
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : pt("provenance.lock.conflict"));
    } finally {
      setLockSaving(false);
    }
  };

  const handleDeleteLock = async (lock: FactLockOut) => {
    try {
      await deleteFactLock(resumeId, lock.id);
      await loadLocks();
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    }
  };

  return {
    locks,
    locksLoading,
    lockSaving,
    lockError,
    handleCreateLock,
    handleDeleteLock,
  };
}
