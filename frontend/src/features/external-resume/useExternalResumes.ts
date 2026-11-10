// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历面板的取数与动作（第 21 条）：列表 / 上传 / 删除。
 *
 * 为什么单独一个 feature hook：面板（列表 + 空态 + 操作）与上传弹窗都要"上传成功后
 * 刷新列表"，把这份状态留在两个组件里会出现两份 loading、两次刷新和两种失败提示。
 * 这里只做**取数与动作**，Toast 文案与跳转由组件决定（同一动作在不同入口措辞不同）。
 *
 * 删除是软删（进回收站），所以这里只负责调 delete 接口；"撤销"由面板用
 * `restoreTrashItem` 提供——恢复是回收站的语义，不属于本 hook。
 */
import { useCallback, useState } from "react";
import {
  deleteExternalResume,
  listExternalResumes,
  uploadExternalResume,
} from "../../api/externalResumes";
import type { ExternalResumeDetail, ExternalResumeItem } from "../../api/externalResumes";
import { useApi } from "../../hooks/useApi";

/** 面板一次展示多少条：外部简历是"用户手动上传的几份"，不是需要翻页的流水。 */
const PAGE_SIZE = 100;

export interface ExternalResumeUploadOptions {
  name?: string;
  jobId?: number | null;
}

export interface ExternalResumesApi {
  items: ExternalResumeItem[];
  total: number;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  uploading: boolean;
  upload: (file: File, options?: ExternalResumeUploadOptions) => Promise<ExternalResumeDetail>;
  remove: (id: number) => Promise<void>;
}

export function useExternalResumes(): ExternalResumesApi {
  const listing = useApi(() => listExternalResumes({ page_size: PAGE_SIZE }), []);
  const { reload } = listing;
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File, options: ExternalResumeUploadOptions = {}) => {
      setUploading(true);
      try {
        const record = await uploadExternalResume(file, {
          name: options.name,
          jobId: options.jobId ?? null,
        });
        await reload();
        return record;
      } finally {
        setUploading(false);
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteExternalResume(id);
      await reload();
    },
    [reload],
  );

  return {
    items: listing.data?.items ?? [],
    total: listing.data?.total ?? 0,
    loading: listing.loading,
    error: listing.error,
    reload,
    uploading,
    upload,
    remove,
  };
}
