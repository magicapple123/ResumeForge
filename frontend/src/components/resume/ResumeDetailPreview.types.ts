// SPDX-License-Identifier: Apache-2.0
/** 简历详情预览的对外契约（2026-10-28 从 ResumeDetailPreview 拆出，压 500 行预算）。
 *
 * 只放类型：Props 是宿主的接线面，和渲染逻辑分开后两边都更容易读。
 */
import type { ReactNode, RefObject } from "react";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import type {
  ResumeContent,
  ResumeDetail,
  ResumeLayout,
} from "../../types";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { RichTextEditAdapter } from "../resume-preview/richText";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import type { PathRemap } from "../../features/resume-outline/paths";

export interface LayoutStatus {
  pages: number;
  overflow: boolean;
}
export interface Props {
  detail: ResumeDetail;
  /** 已渲染的预览 HTML（由父组件负责取数 / 重渲染后传入）。 */
  html: string;
  layout: ResumeLayout;
  layoutStatus: LayoutStatus | null;
  /** 预览量到的实测高度：由预览上报、这里转交给诊断面板。 */
  measure: LayoutMeasure | null;
  pdfDirectAvailable: boolean;
  relayouting: boolean;
  /** 预览句柄：版式控件 / 诊断卡需要用它注入探针 CSS 与量高。 */
  previewRef: RefObject<ResumePreviewHandle | null>;
  onLayoutStatus: (status: LayoutStatus | null) => void;
  onMeasure: (measure: LayoutMeasure | null) => void;
  onApplyLayout: (next: ResumeLayout) => void;
  /** 版式落库：onApplyLayout 只重排不落库，缺这根线版式会静默丢；false=没落库（宿主已弹原因）。 */
  onCommitLayout?: () => Promise<boolean>;
  /** 版式 PATCH 在飞：顶部「保存修改」据此禁用。 */ layoutSaving?: boolean;
  /** 草稿发布（0051）：什么都没脏时点「保存到简历中心」，宿主发一次内容 PATCH 清掉 draft。 */
  onPublishDraft?: () => Promise<boolean>;
  /**
   * W02 条件写通道：制作台整体保存 / 409 冲突三选一（用最新的、比较、另存副本）都靠它。
   * 缺省 = 旧的无条件写（生成流程那种宿主没有版本保护，行为不变）。
   */
  documentPipeline?: ResumeDocumentPipeline;
  /** 「自动一页」试出方案并保存后的重渲染（只重渲染，不再写回版式）。 */
  onApplyFittedFormat: (formatConfig: ResumeFormatConfig) => void;
  onSaveEditedResume: (content: ResumeContent) => Promise<void>;
  /** 初次挂载就打开制作台（「新建 → 前往制作台」专用，由 `zoomOpen` 的初值消费）。 */
  autoOpenWorkbench?: boolean;
  /** 是否已经生成过岗位优化建议：决定按钮文案是「生成」还是「查看」。 */
  suggestionsGenerated: boolean;
  suggestionsResetKey: number;
  onSuggestionsGenerated: () => void;
  /** 修订（AI 修改 / 采纳建议）成功后刷新预览：父组件负责 setDetail + 重渲染。
   * 按钮显隐由 ``showReviseAction`` 单独控制（生成弹窗已自带「重新生成」向导）。 */
  onResumeRevised?: (detail: ResumeDetail) => Promise<void> | void;
  /** 是否显示「AI 修改 / 重新生成」按钮；缺省跟随 ``onResumeRevised`` 是否传入。 */
  showReviseAction?: boolean;
  /** 额外操作（如生成弹窗里的「重新生成 / 去简历中心 / 完成」）插在底部按钮区。 */
  extraActions?: ReactNode;
  /** 叠加「右键加粗」overlay 之后的正文：只喂制作台的实时预览（编辑器仍用服务端那份）。 */
  liveContent?: ResumeContent;
  /** 加粗契约：只传给制作台——主预览没有内容保存入口，在这里加粗关窗就会静默丢掉。 */
  richEdit?: RichTextEditAdapter;
  /** 纸面加粗还没保存：并入制作台脏值（否则"加了粗、关窗即丢"，且顶部不出保存按钮）。 */
  richDirty?: boolean;
  /** 丢掉这些 overlay（取消修改 / 放弃并关闭）。 */
  onDiscardRichText?: () => void;
  /**
   * 合并加粗 overlay 的纯函数（宿主的 `overlays.merge`）。只交给制作台的实时预览：
   * 中栏草稿里没有 overlay，不合并就会"改了字、纸面上的加粗消失"。
   */
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  /** W06 大纲结构命令后：宿主重映射加粗 overlay 与事实标注的 path。 */
  onRemapPaths?: (remap: PathRemap) => void;
  /** 服务端已有新版本（表达资产插入等）：宿主刷新 detail/html/revision。 */
  onDocumentSynced?: (detail: ResumeDetail) => void;
  /**
   * 导出入口走哪条链路（W19）：`delivery`（默认，已保存简历 → 导出交付包）/
   * `legacy`（生成流程/未保存预览 → 旧导出选项面板，避免把草稿当已保存简历核对）。
   */
  exportFlow?: "delivery" | "legacy";
}
