// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场「添加外部简历」的编排（整改 #6）。
 *
 * 为什么单独成 hook：JobTable 已经有 370+ 行（列定义占了大半），而这一件事要接状态
 * （当前是哪一行、上传中）、接口（上传 + 关联）、反馈（Toast 带「查看」）与导航四件事，
 * 写进表格里会把它推过行数预算，也会让"表格渲染"和"上传流程"耦在一起。
 *
 * 与简历中心那份上传的差别只有一条：**岗位由入口定好**（`presetJob`），所以弹窗里不再
 * 让人选岗位，提交固定用这一行的 id，成功后 Toast 的「查看」直接落到该岗位的筛选结果
 * （`/resumes/external?job_id=N`，这是 §0 里约定的外部简历深链）。
 */
import { App } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { uploadExternalResume } from "../../api/externalResumes";
import ExternalResumeUploadModal from "../resume/list/ExternalResumeUploadModal";
import type { ExternalResumeUploadPresetJob } from "../resume/list/ExternalResumeUploadModal";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";

export interface JobExternalResumeUpload {
  /** 「添加外部简历」入口：把这一行岗位设为预设岗位并打开弹窗。 */
  openForJob: (job: { id: number; title: string }) => void;
  /** 要渲染在表格旁边的弹窗（没有目标时 `open=false`，内容为空）。 */
  modal: ReactNode;
}

export function useJobExternalResumeUpload(): JobExternalResumeUpload {
  const navigate = useNavigate();
  const toast = useToast();
  const { message } = App.useApp();
  const [target, setTarget] = useState<ExternalResumeUploadPresetJob | null>(null);
  const [uploading, setUploading] = useState(false);

  const openForJob = (job: { id: number; title: string }): void => {
    setTarget({ id: job.id, title: job.title });
  };

  /**
   * 提交：关联的岗位始终是**入口那一行**（`options.jobId` 只用于不带 preset 的旧路径，
   * 这里不用它），这样即使弹窗内状态被误改也关联到用户右键的那一条。
   */
  const submit = async (
    file: File,
    options: { name: string; jobId: number | null },
  ): Promise<boolean> => {
    const job = target;
    if (!job) return false;
    setUploading(true);
    try {
      const record = await uploadExternalResume(file, { name: options.name, jobId: job.id });
      const viewAction = {
        label: t("resumesPage.external.openList"),
        onClick: () => navigate(`/resumes/external?job_id=${job.id}`),
      };
      if (record.has_text) {
        toast.success(t("resumesPage.external.addedToJob", { name: record.name, job: job.title }), {
          action: viewAction,
        });
      } else {
        // 扫描件不是失败：文件已存、岗位已关联，只是没有正文；提示语要说清这一点。
        toast.warning(
          t("resumesPage.external.addedToJobNoText", { name: record.name, job: job.title }),
          { action: viewAction },
        );
      }
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumesPage.external.uploadFailed"));
      return false;
    } finally {
      setUploading(false);
    }
  };

  return {
    openForJob,
    modal: (
      <ExternalResumeUploadModal
        open={target !== null}
        uploading={uploading}
        presetJob={target ?? undefined}
        onClose={() => setTarget(null)}
        onSubmit={submit}
      />
    ),
  };
}
