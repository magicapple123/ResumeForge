// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位表单的状态与提交（抽屉的一个 hook，不是新的一层组件）。
 *
 * 为什么抽出来：抽屉要同时管列表取数/分页/多选和表单，写在一起会重新长回 480 行。
 * 与 `useCandidateBatchTools` 同一个口径——**状态所有权留在抽屉，hook 只收"改值 + 发请求 + 给提示"**。
 *
 * 未保存判据 `dirty` 由这里给出（任何一次 `change` 都置脏），抽屉拿它决定关闭时要不要出
 * L2 内联确认条（与 `FormModal` 的分级同一套语义：无脏值直接关、有脏值先问）。
 */
import { App } from "antd";
import { useCallback, useState } from "react";
import { createCandidateJob, updateCandidateJob } from "../../../api/candidateJob";
import { t } from "../../../i18n";
import { readAsDataUrl } from "../../../utils/attachments";
import type { CandidateJob, CandidateJobPayload, CandidateJobSource } from "../../../types";
import type { FormState } from "./candidateShared";
import { EMPTY_FORM, MAX_CANDIDATE_IMAGES, MAX_IMAGE_BYTES } from "./candidateShared";

/** 把一条候选摊成表单初值（编辑用）。 */
export function formStateOf(candidate: CandidateJob): FormState {
  return {
    title: candidate.title,
    company: candidate.company,
    sourceUrl: candidate.source_url,
    rawText: candidate.raw_text,
    note: candidate.note,
    images: candidate.images ?? [],
  };
}

export interface CandidateFormApi {
  editing: CandidateJob | null;
  formState: FormState;
  submitting: boolean;
  /** 有没有未保存的改动（关闭时要先问）。 */
  dirty: boolean;
  openCreate: () => void;
  openEdit: (candidate: CandidateJob) => void;
  change: (updater: (current: FormState) => FormState) => void;
  addImages: (file: File) => void;
  submit: () => Promise<void>;
  /** 回到"没有任何未保存内容"的状态（回列表、打开另一条时调用）。 */
  reset: () => void;
  /** 拖入不支持的图片类型时的提示（`FileDropZone` 的 onRejected）。 */
  rejectHint: () => void;
}

/** @param onSaved 保存成功后的收尾（抽屉据此回列表并重拉列表）。 */
export function useCandidateForm(onSaved: () => Promise<void>): CandidateFormApi {
  const { message } = App.useApp();
  const [editing, setEditing] = useState<CandidateJob | null>(null);
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);

  const reset = useCallback(() => {
    setEditing(null);
    setFormState(EMPTY_FORM);
    setDirty(false);
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormState(EMPTY_FORM);
    setDirty(false);
  }, []);

  const openEdit = useCallback((candidate: CandidateJob) => {
    setEditing(candidate);
    setFormState(formStateOf(candidate));
    setDirty(false);
  }, []);

  const change = useCallback((updater: (current: FormState) => FormState) => {
    setFormState(updater);
    setDirty(true);
  }, []);

  const addImages = async (file: File) => {
    if (file.size > MAX_IMAGE_BYTES) {
      message.error(t("jobs.candidate.image-too-large"));
      return;
    }
    if (formState.images.length >= MAX_CANDIDATE_IMAGES) {
      message.warning(t("jobs.candidate.image-limit", { count: MAX_CANDIDATE_IMAGES }));
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      setFormState((current) => ({ ...current, images: [...current.images, dataUrl] }));
      setDirty(true);
    } catch {
      message.error(t("jobs.candidate.image-read-failed"));
    }
  };

  const submit = async (): Promise<void> => {
    if (submitting) return;
    // 来源是**写入值**而不是纯展示：它的取值域与后端 `CandidateJobSource` 是同一套字面量，
    // 所以这里把语言包里的同名文案显式收窄成那个联合类型（单一语言下两者逐字相同）。
    const autoSource = (
      formState.images.length > 0
        ? t("jobs.candidate.form.source-image")
        : t("jobs.candidate.form.source-text")
    ) as CandidateJobSource;
    const payload: CandidateJobPayload = {
      title: formState.title.trim(),
      company: formState.company.trim(),
      source_url: formState.sourceUrl.trim(),
      raw_text: formState.rawText,
      note: formState.note,
      images: formState.images,
      source: editing ? undefined : autoSource,
    };
    if (!payload.title && !payload.raw_text?.trim() && formState.images.length === 0) {
      message.warning(t("jobs.candidate.need-content"));
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        // 更新接口不接受 source：来源在创建时定下，编辑不改写它。
        await updateCandidateJob(editing.id, {
          title: payload.title,
          company: payload.company,
          source_url: payload.source_url,
          raw_text: payload.raw_text,
          note: payload.note,
          images: payload.images,
        });
        message.success(t("jobs.candidate.updated"));
      } else {
        await createCandidateJob(payload);
        message.success(t("jobs.candidate.created"));
      }
      setDirty(false);
      await onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("jobs.candidate.save-failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const rejectHint = useCallback(() => {
    message.error(t("jobs.candidate.image-type-rejected"));
  }, [message]);

  return {
    editing,
    formState,
    submitting,
    dirty,
    openCreate,
    openEdit,
    change,
    addImages: (file) => void addImages(file),
    submit,
    reset,
    rejectHint,
  };
}
