// SPDX-License-Identifier: Apache-2.0
/**
 * 题库/面试共用的「岗位 + 简历」材料状态：岗位**只从记录选**（Q3），简历仍是记录 or 文件。
 *
 * `resumeSource` 与材料分开存：只有当前选中的那一侧进入提交载荷，另一侧留着是为了用户来回
 * 切换时不丢内容。**不要把"上次粘贴的文本"当成当前材料**。
 *
 * 岗位侧的 `jobSource` / `jobMaterial` 已随"岗位不准导入文件"一起删掉：留一个恒为
 * `"record"` 的状态只会让调用方以为还有另一条路。
 */
import { useEffect, useState } from "react";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import {
  internalResumeValue,
  useExternalResumeApplier,
  useInterviewResumeSelect,
} from "../../hooks/useInterviewResumeSelect";
import { toInternalResumeId, toMaterialPayload } from "../interview/materialPayload";
import type { InterviewMaterialExtract, QuestionBankPayload } from "../../types";
import type { MaterialSourceMode } from "../../pages/interview/MaterialSourceField";

export interface QuestionBankInterviewContext {
  jobId?: number;
  resumeId?: string;
  jobMaterial?: InterviewMaterialExtract | null;
  resumeMaterial?: InterviewMaterialExtract | null;
}

/** Only the resume side can switch sources now; the job side is always a record. */
export function useQuestionBankMaterials() {
  const [jobId, setJobId] = useState<number>();
  const [resumeValue, setResumeValue] = useState<string>();
  const [resumeSource, setResumeSource] = useState<MaterialSourceMode>("record");
  const [resumeMaterial, setResumeMaterial] = useState<InterviewMaterialExtract | null>(null);
  const jobSelect = useJobSearchSelect();
  const externalResume = useExternalResumeApplier({
    useFileSource: () => setResumeSource("file"),
    useFileMaterial: setResumeMaterial,
    clearRecordValue: () => setResumeValue(undefined),
  });
  const resumeSelect = useInterviewResumeSelect({
    jobId: jobId ?? null,
    value: resumeValue,
    onExternal: externalResume.apply,
    onExternalFailed: externalResume.notifyFailed,
    onSelectInternal: setResumeValue,
  });
  useEffect(() => {
    void jobSelect.reload();
    // The search hook owns stable callbacks; initial page only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void resumeSelect.reload();
    // Reload internal candidates when the active job changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const activeResume = resumeSource === "file" ? toMaterialPayload(resumeMaterial) : undefined;
  const resumeId = resumeSource === "record" ? toInternalResumeId(resumeValue) : undefined;
  const payload: QuestionBankPayload = {
    job_id: jobId ?? null,
    ...(resumeSource === "record" ? { resume_id: resumeId ?? null } : {}),
    ...(activeResume ? { resume_text: activeResume.text, resume_title: activeResume.name } : {}),
  };
  const context: QuestionBankInterviewContext = {
    jobId: payload.job_id ?? undefined,
    resumeId: resumeId ? internalResumeValue(resumeId) : undefined,
    // 岗位侧没有文件这一路（Q3）：显式给 null，避免调用方再猜"为什么没有这个键"。
    jobMaterial: null,
    resumeMaterial: activeResume ? resumeMaterial : null,
  };
  return {
    jobId,
    setJobId,
    resumeValue,
    setResumeValue,
    resumeSource,
    setResumeSource,
    resumeMaterial,
    setResumeMaterial,
    jobSelect,
    resumeSelect,
    resumeId,
    payload,
    context,
    hasTarget: Boolean(payload.job_id || payload.resume_id || activeResume?.text.trim()),
  };
}
