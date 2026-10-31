// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页状态（F6）：读 workspace（编辑 DTO）、表单草稿、保存协调、照片。
 *
 * 关键口径：
 * - 数据唯一来源是 GET /api/profile/workspace（定义/顺序/当前组/条目/偏好/上限/升级状态）；
 *   loading / error / retry 三态只有一套出口；
 * - 表单模型：sections[sectionKey] = 条目数组（entry_key 稳定；新建条目用 new: 临时键），
 *   条目顺序即界面顺序，保存时按它决定是否调 reorder；
 * - 保存：唯一实现在 useProfileSaveCoordinator（entries 原子 → 分区内重排 → 全局顺序；
 *   409 保留输入不重试）；本 hook 只提供 collectChanges/getSectionOrder/reloadWorkspace；
 * - 识别状态机在 useProfileRecognition；离开拦截（useProfileLeaveGuard）由页面接线。
 */
import { App, Form, Upload } from "antd";
import type { UploadProps } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSectionOrder } from "../../components/profile/ProfileSectionConfig";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { deleteEntry, getWorkspace, patchFieldPreference } from "../profile-library/api";
import { profileErrorMessage } from "../profile-library/errors";
import { invalidateProjectionCache } from "../profile-library/projectionCache";
import { makeTempEntryKey } from "../profile-library/tempEntryKey";
import { restoreRecentlyDeleted } from "../profile-library/trashUndo";
import type {
  FieldOut,
  ProfileEntryDraft,
  ProfileFormValues,
  WorkspaceOut,
} from "../profile-library/types";
import {
  collectEntryChanges,
  isTempEntryKey,
  mergeFormValues,
  toFormValues,
} from "./profileFormData";
import { useProfileRecognition } from "./useProfileRecognition";
import { useProfileSaveCoordinator, type ProfileSaveOutcome } from "./useProfileSaveCoordinator";
import { useProfileSectionReorder } from "./useProfileSectionReorder";

export type { ProfileFormValues } from "../profile-library/types";

/** workspace 重取口径；保存成功后必须用 `discardDrafts`（见 reloadWorkspace 注释）。 */
export interface WorkspaceReloadOptions {
  /** 丢弃表单里未落库的 new: 临时草稿（服务端真值覆盖表单）。 */
  discardDrafts?: boolean;
}

/** 提交资料表单的结构化结果：调用方（保存全部资料）按它分流（含 409 conflict）。 */
export type ProfileSubmitOutcome = ProfileSaveOutcome;
/** 表单值纯函数已拆到 profileFormData.ts；此处重新导出，保持 useProfilePage 的既有导出面。 */
export {
  asFieldText,
  collectEntryChanges,
  isTempEntryKey,
  mergeFormValues,
  toFormValues,
} from "./profileFormData";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error(t("profileLibrary.photo.readFailed")));
    reader.readAsDataURL(file);
  });
}

interface Options {
  activateResumeWorkspace?: () => void;
  onProfileParsed?: () => void;
  /** 任何未保存改动（含照片/识别回填）都要通知页面置脏。 */
  onDirty: () => void;
}

export function useProfilePage(options: Options) {
  const { message } = App.useApp();
  const toast = useToast();
  const [form] = Form.useForm<ProfileFormValues>();
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [workspace, setWorkspace] = useState<WorkspaceOut | null>(null);
  // 页面在 loading 骨架/错误态不渲染 Form：挂载前 setFieldsValue 会被 antd 首次挂载的
  // initialValues 覆盖。因此先记录"待写入快照"，等 Form 真正挂载后（loading=false 的 effect）
  // 再 resetFields + setFieldsValue，保证首屏/重试后输入框里有已存的值。
  const pendingValuesRef = useRef<ProfileFormValues | null>(null);
  const [valuesNonce, setValuesNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadToken, setLoadToken] = useState(0);
  const [editing, setEditing] = useState(false);
  const [photoReading, setPhotoReading] = useState(false);
  const photoReadId = useRef(0);
  const reorderRef = useRef<ReturnType<typeof useProfileSectionReorder> | null>(null);
  const reloadRef = useRef<(options?: WorkspaceReloadOptions) => Promise<void>>(
    async () => undefined,
  );
  const coordinator = useProfileSaveCoordinator({
    workspace,
    editing,
    loading,
    loadError,
    photoReading,
    form,
    collectChanges: collectEntryChanges,
    getSectionOrder: () => reorderRef.current?.getSectionOrder() ?? [],
    reloadWorkspace: (options) => reloadRef.current(options),
    onSaved: () => setEditing(false),
    invalidateProjection: invalidateProjectionCache,
  });
  const reorder = useProfileSectionReorder({
    editing,
    saving: coordinator.saving,
    photoReading,
  });
  const {
    sectionOrderStore,
    setSectionOrder,
    setSectionReorderMode,
    handleSectionPointerDown,
    moveSectionByOffset,
  } = reorder;
  useEffect(() => {
    reorderRef.current = reorder;
  });
  const photo =
    (Form.useWatch(["sections", "basic_info", 0, "values", "basic_info.photo"], form) as
      string | undefined) ?? "";

  const workspaceRef = useRef<WorkspaceOut | null>(null);
  const editingRef = useRef(editing);
  useEffect(() => {
    workspaceRef.current = workspace;
    editingRef.current = editing;
  }, [editing, workspace]);

  const applyWorkspace = useCallback(
    (next: WorkspaceOut, preserveForm: boolean) => {
      setWorkspace(next);
      const keys = next.sections.map((section) => section.key);
      const nextValues =
        preserveForm && editingRef.current
          ? mergeFormValues(form.getFieldsValue(true) as ProfileFormValues, next)
          : toFormValues(next);
      pendingValuesRef.current = nextValues;
      setValuesNonce((nonce) => nonce + 1);
      setSectionOrder(normalizeSectionOrder(next.section_order, keys));
    },
    [form, setSectionOrder],
  );

  useEffect(() => {
    let active = true;
    // 首次取数置加载态：同步 setState 放进微任务，避开级联渲染告警（仍在请求前生效）。
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    void getWorkspace()
      .then((next) => {
        if (!active) return;
        setLoadError("");
        applyWorkspace(next, false);
        setSectionReorderMode(false);
      })
      .catch((err) => {
        if (!active) return;
        const failure = profileErrorMessage(err);
        setLoadError(failure);
        message.error(failure);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyWorkspace, loadToken, message, setSectionReorderMode]);

  /**
   * 重取 workspace 并回填表单。两种口径：
   * - 默认（删除条目 / 切组 / 字段设置弹层 / 刷新比较）：编辑中保留未保存的 new: 草稿与
   *   已改值，避免"重取把用户正在填的东西冲掉"；
   * - `discardDrafts`（保存成功后）：以服务器真值为准，**丢弃已提交成功的 new: 草稿**。
   *   否则保存后表单里同时有"服务端新条目 + 残留草稿"，下一次保存会把草稿再当新条目
   *   提交一次（用户实测：每保存一次多一条）。
   */
  const reloadWorkspace = useCallback(
    async (options?: WorkspaceReloadOptions): Promise<void> => {
      const next = await getWorkspace();
      applyWorkspace(next, editingRef.current && !options?.discardDrafts);
    },
    [applyWorkspace],
  );
  useEffect(() => {
    reloadRef.current = reloadWorkspace;
  }, [reloadWorkspace]);

  // Form 挂载后才写入（首次 loading=false 或编辑中刷新）；写入后清空待处理，避免重复覆盖用户输入。
  useEffect(() => {
    if (loading) return;
    const values = pendingValuesRef.current;
    if (!values) return;
    form.resetFields();
    form.setFieldsValue(values);
    pendingValuesRef.current = null;
  }, [form, loading, valuesNonce]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    setLoadError("");
    setLoadToken((token) => token + 1);
  }, []);

  const recognition = useProfileRecognition({
    form,
    workspace,
    onDirty: () => optionsRef.current.onDirty(),
    activateResumeWorkspace: options.activateResumeWorkspace,
  });

  useEffect(
    () => () => {
      photoReadId.current += 1;
    },
    [],
  );

  const setPhoto = useCallback(
    (dataUrl: string) => {
      form.setFieldValue(["sections", "basic_info", 0, "values", "basic_info.photo"], dataUrl);
      optionsRef.current.onDirty();
    },
    [form],
  );

  const beforePhotoUpload: UploadProps["beforeUpload"] = useCallback(
    (file) => {
      if (!editingRef.current) return Upload.LIST_IGNORE;
      if (!PHOTO_TYPES.has(file.type)) {
        message.error(t("profileLibrary.photo.formatError"));
        return Upload.LIST_IGNORE;
      }
      if (file.size > PHOTO_MAX_BYTES) {
        message.error(t("profileLibrary.photo.tooLarge"));
        return Upload.LIST_IGNORE;
      }
      const readId = ++photoReadId.current;
      setPhotoReading(true);
      void readAsDataUrl(file)
        .then((dataUrl) => {
          if (photoReadId.current === readId) setPhoto(dataUrl);
        })
        .catch((err) => {
          if (photoReadId.current === readId) {
            message.error(
              err instanceof Error ? err.message : t("profileLibrary.photo.readFailed"),
            );
          }
        })
        .finally(() => {
          if (photoReadId.current === readId) setPhotoReading(false);
        });
      return false;
    },
    [message, setPhoto],
  );

  const addEntry = useCallback(
    (sectionKey: string) => {
      const current =
        (form.getFieldValue(["sections", sectionKey]) as ProfileEntryDraft[] | undefined) ?? [];
      form.setFieldValue(
        ["sections", sectionKey],
        [...current, { entry_key: makeTempEntryKey(), values: {} }],
      );
      optionsRef.current.onDirty();
    },
    [form],
  );

  const replaceField = useCallback((updated: FieldOut) => {
    setWorkspace((current) => {
      if (!current) return current;
      return {
        ...current,
        sections: current.sections.map((section) =>
          section.key === updated.section_key
            ? {
                ...section,
                fields: section.fields.map((field) =>
                  field.field_id === updated.field_id ? updated : field,
                ),
              }
            : section,
        ),
      };
    });
  }, []);

  const setPreference = useCallback(
    async (field: FieldOut, patch: { hidden?: boolean }): Promise<void> => {
      const previous = workspaceRef.current;
      setWorkspace((current) => {
        if (!current) return current;
        return {
          ...current,
          sections: current.sections.map((section) =>
            section.key === field.section_key
              ? {
                  ...section,
                  fields: section.fields.map((item) =>
                    item.field_id === field.field_id
                      ? {
                          ...item,
                          hidden: patch.hidden === undefined ? item.hidden : patch.hidden,
                        }
                      : item,
                  ),
                }
              : section,
          ),
        };
      });
      try {
        const updated = await patchFieldPreference(field.field_id, {
          section_key: field.section_key,
          ...patch,
          expected_revision: field.preference_revision,
        });
        replaceField(updated);
        invalidateProjectionCache();
      } catch (err) {
        if (previous) setWorkspace(previous);
        message.error(profileErrorMessage(err));
      }
    },
    [message, replaceField],
  );

  const removeEntry = useCallback(
    async (sectionKey: string, entryKey: string, title: string): Promise<void> => {
      if (isTempEntryKey(entryKey)) {
        optionsRef.current.onDirty();
        return;
      }
      const stored = workspaceRef.current?.entries.find((entry) => entry.entry_id === entryKey);
      if (!stored) return;
      const startedAt = Date.now();
      try {
        await deleteEntry(sectionKey, entryKey, stored.revision);
        invalidateProjectionCache();
        toast.undo(t("profileLibrary.entry.deleted"), {
          label: t("toast.undo.label"),
          onClick: async () => {
            const restored = await restoreRecentlyDeleted("profile_entry", title, startedAt);
            if (!restored)
              throw new Error(t("profileGroups.manager.restoreFailed", { detail: "-" }));
            await reloadWorkspace();
            invalidateProjectionCache();
          },
        });
        await reloadWorkspace();
      } catch (err) {
        message.error(profileErrorMessage(err));
      }
    },
    [message, reloadWorkspace, toast],
  );

  const submit = coordinator.submit;

  const cancelEditing = useCallback(() => {
    if (coordinator.saving || photoReading) return;
    const current = workspaceRef.current;
    if (current) {
      form.setFieldsValue(toFormValues(current));
      setSectionOrder(
        normalizeSectionOrder(
          current.section_order,
          current.sections.map((section) => section.key),
        ),
      );
    }
    recognition.close();
    setEditing(false);
  }, [coordinator.saving, form, photoReading, recognition, setSectionOrder]);

  return {
    form,
    workspace,
    loading,
    loadError,
    retryLoad,
    reloadWorkspace,
    saving: coordinator.saving,
    saveError: coordinator.error,
    conflictRevision: coordinator.conflictRevision,
    resetSaveError: coordinator.resetError,
    editing,
    setEditing,
    photoReading,
    photo,
    sectionOrderStore,
    handleSectionPointerDown,
    moveSectionByOffset,
    recognition,
    beforePhotoUpload,
    setPhoto,
    addEntry,
    removeEntry,
    setPreference,
    submit,
    cancelEditing,
  };
}
