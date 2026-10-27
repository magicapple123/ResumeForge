// SPDX-License-Identifier: Apache-2.0
/**
 * 资料页保存协调（F6）：唯一保存入口「保存全部资料」。
 *
 * 顺序：PATCH /workspace/entries（本轮全部改动单事务原子）→ 逐分区 PUT entries/reorder
 * （只对已有条目顺序变了的分区；新建条目本来就追加在末尾）→ PUT /section-order（全局
 * 顺序变化时）。409 保留输入、不盲目重试；保存中重复提交直接 skipped（ref 同步挡）。
 */
import type { FormInstance } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { normalizeSectionOrder } from "../../components/profile/ProfileSectionConfig";
import { t } from "../../i18n";
import { reorderEntries, saveEntries, setSectionOrder } from "../profile-library/api";
import { profileErrorMessage } from "../profile-library/errors";
import type {
  BulkEntriesResult,
  BulkEntryItem,
  ProfileFormValues,
  WorkspaceOut,
} from "../profile-library/types";

export type ProfileSaveOutcome = "saved" | "invalid" | "skipped" | "conflict" | "failed";

/** API 注入缝（默认走真实接口；测试传替身，不起网络）。 */
export interface SaveCoordinatorApi {
  saveEntries: typeof saveEntries;
  reorderEntries: typeof reorderEntries;
  setSectionOrder: typeof setSectionOrder;
}

const DEFAULT_API: SaveCoordinatorApi = { saveEntries, reorderEntries, setSectionOrder };
const TEMP_ENTRY_PREFIX = "new:";

interface Options {
  workspace: WorkspaceOut | null;
  editing: boolean;
  loading: boolean;
  loadError: string;
  photoReading: boolean;
  form: FormInstance<ProfileFormValues>;
  /** 表单值 → 本轮变更集（唯一实现在页面工具里，协调器不复制一份）。 */
  collectChanges: (workspace: WorkspaceOut, values: ProfileFormValues) => BulkEntryItem[];
  getSectionOrder: () => string[];
  /**
   * 重取 workspace 并回填表单；保存成功后必须传 `discardDrafts: true`，
   * 否则残留的 new: 草稿会在下一次保存时被当成新条目再提交一次。
   */
  reloadWorkspace: (options?: { discardDrafts?: boolean }) => Promise<void>;
  /** 保存成功后清 dirty / 退出编辑态（页面负责）。 */
  onSaved: () => void;
  invalidateProjection?: () => void;
  api?: SaveCoordinatorApi;
}

export interface ProfileSaveCoordinator {
  saving: boolean;
  /** 最近一次失败的用户可读提示（页面用它 message.error；null=无）。 */
  error: string | null;
  /** 409 时服务端当前 revision，供「刷新比较」提示。 */
  conflictRevision: number | null;
  submit: () => Promise<ProfileSaveOutcome>;
  resetError: () => void;
}

function isRevisionConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && err.businessCode === "revision_conflict";
}

/** 409 响应体里的当前 revision（StoreError 的 extra 字段）。 */
function revisionFromError(err: ApiError): number | null {
  const payload = err.payload;
  if (payload === null || typeof payload !== "object" || !("revision" in payload)) return null;
  const value = (payload as { revision?: unknown }).revision;
  return typeof value === "number" ? value : null;
}

/** 只收集"已有条目顺序真的变了"的分区；有未保存新条目的分区不重排。 */
function collectSectionOrderChanges(
  workspace: WorkspaceOut,
  values: ProfileFormValues,
): Array<{ sectionKey: string; entryIds: string[] }> {
  const changes: Array<{ sectionKey: string; entryIds: string[] }> = [];
  Object.entries(values.sections ?? {}).forEach(([sectionKey, drafts]) => {
    const serverIds = workspace.entries
      .filter((entry) => entry.section_key === sectionKey)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((entry) => entry.entry_id);
    const desired = drafts.map((draft) => draft.entry_key);
    if (desired.some((key) => key.startsWith(TEMP_ENTRY_PREFIX))) return;
    if (desired.length !== serverIds.length) return;
    if (desired.join("|") !== serverIds.join("|")) {
      changes.push({ sectionKey, entryIds: desired });
    }
  });
  return changes;
}

export function useProfileSaveCoordinator({
  workspace,
  editing,
  loading,
  loadError,
  photoReading,
  form,
  collectChanges,
  getSectionOrder,
  reloadWorkspace,
  onSaved,
  invalidateProjection,
  api = DEFAULT_API,
}: Options): ProfileSaveCoordinator {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const savingRef = useRef(false);
  const workspaceRef = useRef(workspace);
  // 同步最新 workspace 到 ref（事件时刻读，避免把整个 hook 重渲染挂在 workspace 引用上）。
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const resetError = useCallback(() => {
    setError(null);
    setConflictRevision(null);
  }, []);

  const submit = useCallback(async (): Promise<ProfileSaveOutcome> => {
    if (savingRef.current) return "skipped";
    const current = workspaceRef.current;
    if (!editing || loading || loadError || photoReading || current === null) return "skipped";

    let values: ProfileFormValues;
    try {
      values = (await form.validateFields()) as ProfileFormValues;
    } catch {
      return "invalid";
    }

    const items = collectChanges(current, values);
    const sectionKeys = current.sections.map((section) => section.key);
    const nextOrder = normalizeSectionOrder(getSectionOrder(), sectionKeys);
    const orderChanged = nextOrder.join("|") !== current.section_order.join("|");
    const sectionOrderChanges = collectSectionOrderChanges(current, values);
    if (items.length === 0 && !orderChanged && sectionOrderChanges.length === 0) {
      onSaved();
      return "saved";
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setConflictRevision(null);
    try {
      let saved: BulkEntriesResult;
      try {
        saved = await api.saveEntries(items, current.workspace_revision);
      } catch (err) {
        if (isRevisionConflict(err)) {
          setConflictRevision(revisionFromError(err));
          setError(profileErrorMessage(err));
          return "conflict";
        }
        setError(t("profileLibrary.save.failed", { detail: profileErrorMessage(err) }));
        return "failed";
      }

      let orderFailure: unknown = null;
      for (const change of sectionOrderChanges) {
        try {
          await api.reorderEntries(change.sectionKey, change.entryIds, saved.workspace_revision);
        } catch (err) {
          orderFailure = err;
          break;
        }
      }
      if (orderFailure === null && orderChanged) {
        try {
          await api.setSectionOrder(nextOrder, saved.workspace_revision);
        } catch (err) {
          orderFailure = err;
        }
      }
      if (orderFailure !== null) {
        // 条目已落库但顺序没存上：先如实告知，再重取服务器真值（丢弃已提交的 new: 草稿，
        // 否则下一次保存会把同一条再建一遍）。重取失败不覆盖主错误提示。
        const resyncAfterEntriesSaved = async () => {
          try {
            await reloadWorkspace({ discardDrafts: true });
          } catch {
            // 保留对用户的错误提示；他仍可手动刷新。
          }
        };
        if (isRevisionConflict(orderFailure)) {
          setConflictRevision(revisionFromError(orderFailure));
          setError(profileErrorMessage(orderFailure));
          await resyncAfterEntriesSaved();
          return "conflict";
        }
        setError(t("profileLibrary.save.failed", { detail: profileErrorMessage(orderFailure) }));
        await resyncAfterEntriesSaved();
        return "failed";
      }

      invalidateProjection?.();
      // 保存成功后的重载以服务器真值为准：丢掉已提交成功的 new: 临时草稿。
      await reloadWorkspace({ discardDrafts: true });
      onSaved();
      return "saved";
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    api,
    collectChanges,
    editing,
    form,
    getSectionOrder,
    invalidateProjection,
    loadError,
    loading,
    onSaved,
    photoReading,
    reloadWorkspace,
  ]);

  return { saving, error, conflictRevision, submit, resetError };
}
