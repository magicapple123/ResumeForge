// SPDX-License-Identifier: Apache-2.0
/**
 * 命名版本的状态编排（W13）：列表/创建/冻结/恢复/比较。
 *
 * 三条语义来自契约，前端不能自造：
 * 1. 版本快照不可变，恢复 = **写一个新的当前版本**（不是把历史改回去）；
 * 2. 恢复是条件写：409 + resume_revision_conflict 时一个字段都没写，**不自动重试覆盖**，
 *    交给用户刷新后重试；
 * 3. 版本数据不写草稿存储：失败不清草稿（这里根本不碰草稿）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  compareVersions,
  createVersion,
  freezeVersion,
  listVersions,
  restoreVersion,
} from "./versionsApi";
import { sortVersions } from "./model";
import type { VersionCompareOut, VersionOut, VersionRestoreOut } from "./types";

export interface RestoreConflict {
  /** 后端返回的当前 revision（payload 里能拿到就用，拿不到由宿主刷新）。 */
  currentRevision: number | null;
  message: string;
}

export interface UseVersionsOptions {
  resumeId?: number | null;
  /** 恢复成功后通知宿主（更新当前简历/revision；不要自己猜新的 revision）。 */
  onRestored?: (result: VersionRestoreOut) => void;
}

export function useVersions({ resumeId, onRestored }: UseVersionsOptions) {
  const [versions, setVersions] = useState<VersionOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [conflict, setConflict] = useState<RestoreConflict | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (resumeId == null) {
      setVersions([]);
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    setLoading(true);
    setError("");
    try {
      const data = await listVersions(resumeId);
      if (token !== requestRef.current) return;
      setVersions(sortVersions(data.items));
    } catch (caught) {
      if (token !== requestRef.current) return;
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, [resumeId]);

  // 切简历/切数据集：清状态再重拉（旧版本的列表不能留在新简历上）。
  useEffect(() => {
    setVersions([]);
    setConflict(null);
    setActionError("");
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string, changeSummary = ""): Promise<VersionOut | null> => {
      if (resumeId == null) return null;
      setActionError("");
      try {
        const created = await createVersion(resumeId, {
          name,
          change_summary: changeSummary,
        });
        setVersions((current) => sortVersions([created, ...current]));
        return created;
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "");
        return null;
      }
    },
    [resumeId],
  );

  const setFrozen = useCallback(
    async (versionId: number, frozen: boolean): Promise<boolean> => {
      if (resumeId == null) return false;
      setActionError("");
      try {
        const updated = await freezeVersion(resumeId, versionId, frozen);
        setVersions((current) =>
          current.map((version) => (version.id === updated.id ? updated : version)),
        );
        return true;
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "");
        return false;
      }
    },
    [resumeId],
  );

  const restore = useCallback(
    async (versionId: number, expectedRevision?: number): Promise<VersionRestoreOut | null> => {
      if (resumeId == null) return null;
      setActionError("");
      setConflict(null);
      setRestoringId(versionId);
      try {
        const result = await restoreVersion(resumeId, versionId, expectedRevision);
        onRestored?.(result);
        await reload();
        return result;
      } catch (caught) {
        if (caught instanceof ApiError && caught.businessCode === "resume_revision_conflict") {
          const payload = caught.payload as { revision?: unknown } | undefined;
          const revision = typeof payload?.revision === "number" ? payload.revision : null;
          setConflict({ currentRevision: revision, message: caught.message });
          return null;
        }
        setActionError(caught instanceof Error ? caught.message : "");
        return null;
      } finally {
        setRestoringId(null);
      }
    },
    [onRestored, reload, resumeId],
  );

  const compare = useCallback(
    async (
      baseVersionId: number,
      against: number | "current",
    ): Promise<VersionCompareOut | null> => {
      if (resumeId == null) return null;
      setActionError("");
      try {
        return await compareVersions(resumeId, baseVersionId, against);
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "");
        return null;
      }
    },
    [resumeId],
  );

  return {
    versions,
    loading,
    error,
    actionError,
    restoringId,
    conflict,
    setConflict,
    reload,
    create,
    setFrozen,
    restore,
    compare,
  };
}
