// SPDX-License-Identifier: Apache-2.0
/**
 * 求职偏好档（T14）的取数与写操作。
 *
 * 三条边界：
 * - 读取走统一 GET（items 只含 active 且未删除的行，顺序由后端按 inject_priority 给）；
 * - 撤销的 409 稳定码（not_current / no_previous）翻成人话，而不是把中文 detail 直接抛给
 *   用户——「没有上一版可撤销」是**正常的空态**，不是故障；
 * - 删除是软删：成功后给 5 秒「撤销」（后端 DELETE 响应带回收站需要的行 id）。
 */
import { useCallback, useState } from "react";
import { ApiError } from "../../api/client";
import {
  createJobPreference,
  deleteJobPreference,
  getJobPreferences,
  undoJobPreference,
  updateJobPreference,
  type JobPreference,
  type JobPreferenceInput,
  type JobPreferenceList,
  type JobPreferenceUpdateInput,
} from "../../api/jobPreferences";
import { restoreTrashItem } from "../../api/trash";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../hooks/useToast";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface JobPreferencesController {
  data: JobPreferenceList | undefined;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  /** 写操作进行中（成功/失败提示由本 hook 发；调用方只管关闭弹窗）。 */
  saving: boolean;
  create: (input: JobPreferenceInput) => Promise<boolean>;
  update: (prefId: string, input: JobPreferenceUpdateInput) => Promise<boolean>;
  remove: (pref: JobPreference) => Promise<boolean>;
  undo: (pref: JobPreference) => Promise<boolean>;
}

/** 把接口错误翻成可行动的提示：409 稳定码优先，其余用后端 detail。 */
function preferenceErrorText(error: unknown, fallbackKey: MessageKey): string {
  if (error instanceof ApiError) {
    if (error.businessCode === "not_current") return t("jobPreference.error.notCurrent");
    if (error.businessCode === "no_previous") return t("jobPreference.error.noPrevious");
  }
  return error instanceof Error && error.message.trim() ? error.message : t(fallbackKey);
}

export function useJobPreferences(): JobPreferencesController {
  useLocale();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<JobPreferenceList>(() => getJobPreferences(), []);
  const [saving, setSaving] = useState(false);

  const create = useCallback(
    async (input: JobPreferenceInput): Promise<boolean> => {
      setSaving(true);
      try {
        await createJobPreference(input);
        toast.success(t("jobPreference.toast.created"));
        await reload();
        return true;
      } catch (createError) {
        toast.error(preferenceErrorText(createError, "jobPreference.error.save"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reload, toast],
  );

  const update = useCallback(
    async (prefId: string, input: JobPreferenceUpdateInput): Promise<boolean> => {
      setSaving(true);
      try {
        await updateJobPreference(prefId, input);
        toast.success(t("jobPreference.toast.updated"));
        await reload();
        return true;
      } catch (updateError) {
        toast.error(preferenceErrorText(updateError, "jobPreference.error.save"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reload, toast],
  );

  const remove = useCallback(
    async (pref: JobPreference): Promise<boolean> => {
      setSaving(true);
      try {
        const result = await deleteJobPreference(pref.pref_id);
        await reload();
        if (result.id === undefined) {
          // 后端没给回收站行 id（旧版本）：仍如实说"可在回收站恢复"，但给不出撤销按钮。
          toast.success(t("jobPreference.toast.deletedTrash"));
          return true;
        }
        const trashId = result.id;
        toast.undo(
          t("jobPreference.toast.deleted"),
          {
            label: t("toast.undo.label"),
            onClick: async () => {
              try {
                await restoreTrashItem("job_preference", trashId);
                toast.success(t("toast.restored.single"));
                await reload();
              } catch (restoreError) {
                toast.error(preferenceErrorText(restoreError, "jobPreference.error.restore"));
              }
            },
          },
          { key: `undo-job-preference-${pref.pref_id}` },
        );
        return true;
      } catch (deleteError) {
        toast.error(preferenceErrorText(deleteError, "jobPreference.error.delete"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reload, toast],
  );

  const undo = useCallback(
    async (pref: JobPreference): Promise<boolean> => {
      setSaving(true);
      try {
        await undoJobPreference(pref.pref_id);
        toast.success(t("jobPreference.toast.undone"));
        await reload();
        return true;
      } catch (undoError) {
        toast.error(preferenceErrorText(undoError, "jobPreference.error.undo"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reload, toast],
  );

  return { data, loading, error, reload, saving, create, update, remove, undo };
}
