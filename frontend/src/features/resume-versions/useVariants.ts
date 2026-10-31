// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位变体的状态编排（W13）：列表/派生/选择性同步。
 *
 * 语义（契约 §3）：变体是独立表达，同步**只改用户勾选的路径**；没有被勾选的岗位定制
 * 原样保留。失败不猜、不回滚界面之外的东西——重新拉列表。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createVariant, listVariants, syncVariants } from "./versionsApi";
import type { VariantOut, VariantSyncOut, VariantSyncRequest } from "./types";

export interface UseVariantsOptions {
  resumeId?: number | null;
}

export function useVariants({ resumeId }: UseVariantsOptions) {
  const [variants, setVariants] = useState<VariantOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (resumeId == null) {
      setVariants([]);
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    setLoading(true);
    setError("");
    try {
      const data = await listVariants(resumeId);
      if (token !== requestRef.current) return;
      setVariants(data.items);
    } catch (caught) {
      if (token !== requestRef.current) return;
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, [resumeId]);

  useEffect(() => {
    // 切简历先清列表再重拉：同步 setState 放进微任务，避开级联渲染告警（仍在本帧内生效）。
    queueMicrotask(() => {
      setVariants([]);
      setActionError("");
      void reload();
    });
  }, [reload]);

  const create = useCallback(
    async (name: string, baseVersionId?: number | null): Promise<VariantOut | null> => {
      if (resumeId == null) return null;
      setActionError("");
      try {
        const created = await createVariant(resumeId, {
          name,
          base_version_id: baseVersionId ?? null,
        });
        setVariants((current) => [...current, created]);
        return created;
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "");
        return null;
      }
    },
    [resumeId],
  );

  const sync = useCallback(
    async (payload: VariantSyncRequest): Promise<VariantSyncOut | null> => {
      if (resumeId == null) return null;
      setActionError("");
      setSyncing(true);
      try {
        const result = await syncVariants(resumeId, payload);
        await reload();
        return result;
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "");
        return null;
      } finally {
        setSyncing(false);
      }
    },
    [reload, resumeId],
  );

  return { variants, loading, error, actionError, syncing, reload, create, sync };
}
