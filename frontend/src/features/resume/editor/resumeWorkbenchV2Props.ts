// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台外壳的入参。
 *
 * 单独成文件是因为 `ResumeWorkbenchV2.tsx` 已经贴到 500 行预算——这些只是形状
 * 声明，没必要占着组件的行数。原模块仍 `export type { ResumeWorkbenchV2Props }`，
 * 既有引用方的 import 路径不受影响。
 */
import type { RefObject } from "react";
import type { GenerationContextSnapshot } from "../../career-scenarios/types";
import type { ResumeDocumentPipeline } from "../document/types";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../preview/ResumePreview";
import type { PreviewMode } from "../preview/config";
import type { FactAnnotation, ResumeDetail, ResumeLanguage, ResumeLayout } from "../../../types";
import type { DocumentConversionSummary } from "../../../types/resume";
import type { DocumentFieldCatalog, ResumeDocument } from "../../../types/resumeDocument";

export interface ResumeWorkbenchV2Props {
  open: boolean;
  html: string;
  warnings: string[];
  /** 记录里的页数上限（预览虚线按它切）。 */
  pages: number;
  onClose: () => void;
  layout?: ResumeLayout;
  resumeId?: number;
  resumeTitle?: string;
  resumeLanguage?: ResumeLanguage;
  relayouting?: boolean;
  hasPhoto?: boolean;
  pagesNeeded?: number | null;
  onApplyLayout?: (next: ResumeLayout) => void;
  onCommitLayout?: () => Promise<boolean>;
  documentPipeline?: ResumeDocumentPipeline;
  layoutSaving?: boolean;
  onExport?: () => void;
  previewRef?: RefObject<ResumePreviewHandle | null>;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  exactPreview?: ExactPreviewOptions;
  /** 这份简历当前已保存的 v2 文档；null/缺省 = 中栏不渲染（只读预览宿主）。 */
  document?: ResumeDocument | null;
  /** 没有 pipeline 的宿主（生成流程只读预览）：无条件保存正文。 */
  onSaveContent?: (content: ResumeDocument, expectedRevision?: number) => Promise<number | void>;
  onEditorDirtyChange?: (dirty: boolean) => void;
  isDraft?: boolean;
  onPublishDraft?: () => Promise<boolean>;
  /** 旧简历转换摘要：显示在编辑区顶部，保存成功后宿主置空。 */
  conversion?: DocumentConversionSummary | null;
  /** 后端字段目录：编辑器「添加字段」菜单与结构面板的仅素材徽标共用。 */
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 后端 resume_record.document_mode（左栏文档模式开关的当前值）。 */
  documentMode?: "resume" | "long_cv";
  /** 文档模式保存成功：宿主用后端最新详情刷新 detail/html/revision。 */
  onDocumentModeSaved?: (detail: ResumeDetail) => void;
  /**
   * 页签内组件（表达资产插入 / 双语采纳 / 来源采纳）**服务端已落库**后的宿主替换出口：
   * 宿主更新 detail/html/revision 并重排。工作台内部还会把历史基线对齐到新文档。
   */
  onAdoptDocument?: (document: ResumeDocument, revision: number) => void;
  contextSnapshot?: GenerationContextSnapshot | null;
  /**
   * #24 24E / 24F：与预览卡**同源**的详情数据（宿主只取一次，这里不再发请求）：
   * 标注 → 中栏字段旁来源徽标；说明 → 左栏「生成说明」入口。缺省 / 空 = 不渲染。
   */
  factAnnotations?: FactAnnotation[] | null;
  rationale?: string | null;
}
