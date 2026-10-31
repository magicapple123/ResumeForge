// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档模式」保存接线（v2 制作台左栏「排版参数」顶部）。
 *
 * 纯展示组件 research/DocumentModeSwitch 只回传"夹紧后的 模式+页数"；这里负责
 * 真正落库：PATCH /resumes/{id}/layout（整体替换 + expected_revision 条件写，
 * 见 features/resume-research/api.ts），成功后把后端夹紧的真实 page_limit 交回宿主。
 *
 * 为什么挂在左栏而不是动作条：整屏动作条只回答"保存/取消"，模式是低频但会改变
 * 篇幅预算的设置，和模板/字号一起放参数栏才找得到。
 */
import { App } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeDetail, ResumeLayout, ResumeTemplateCatalog } from "../../types";
import DocumentModeSwitch from "./research/DocumentModeSwitch";
import {
  modeLimitsFromCatalog,
  saveDocumentMode,
  type DocumentModePatch,
} from "../../features/resume-research/api";

export interface DocumentModePanelProps {
  /** 没有记录 id（生成流程只读宿主）时整块不渲染：没有可保存的落点。 */
  resumeId?: number | null;
  /** 条件写版本号：宿主 detail.revision。 */
  revision?: number | null;
  /** 后端列 resume_record.document_mode（未知/缺省按普通简历）。 */
  documentMode?: "resume" | "long_cv";
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  pagesNeeded?: number | null;
  /** 宿主版式保存/重排在飞（与其它参数控件同一禁用口径）。 */
  saving?: boolean;
  disabled?: boolean;
  /** 后端夹紧后的 page_limit 回写当前草稿版式（让左栏滑杆当场一致）。 */
  onChange: (next: ResumeLayout) => void;
  /** 保存成功：宿主用后端最新详情刷新 detail/html/revision。 */
  onSaved?: (detail: ResumeDetail) => void;
}

export default function DocumentModePanel({
  resumeId,
  revision,
  documentMode,
  layout,
  catalog,
  pagesNeeded,
  saving = false,
  disabled = false,
  onChange,
  onSaved,
}: DocumentModePanelProps) {
  useLocale();
  const { message } = App.useApp();
  const [modeSaving, setModeSaving] = useState(false);
  const meta = modeLimitsFromCatalog(catalog);
  if (!resumeId) return null;

  const handleChange = async (patch: DocumentModePatch) => {
    if (modeSaving) return;
    setModeSaving(true);
    try {
      const saved = await saveDocumentMode(resumeId, layout, patch, revision ?? null);
      onSaved?.(saved);
      // 后端会按模式夹紧页数：把真实值写回草稿，滑杆与后端不再差一档。
      if (saved.page_limit !== layout.page_limit) {
        onChange({ ...layout, page_limit: saved.page_limit });
      }
    } catch (error) {
      message.error(
        error instanceof Error && error.message ? error.message : t("workbench.save.layout-failed"),
      );
    } finally {
      setModeSaving(false);
    }
  };

  return (
    <DocumentModeSwitch
      mode={documentMode}
      pageLimit={layout.page_limit}
      limits={meta.limits}
      defaultLongCvPageLimit={meta.defaultLongCvPageLimit}
      pagesNeeded={pagesNeeded}
      saving={saving || modeSaving}
      disabled={disabled || undefined}
      onChange={(next) => void handleChange(next)}
    />
  );
}
