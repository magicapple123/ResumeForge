// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」外壳的 props 契约（2026-10-27 从 `ResumeZoomModal.tsx` 拆出）。
 *
 * 拆出的唯一原因：外壳要装三栏编排 + 条件保存 + 六个领域挂载点，已贴住 500 行硬预算；
 * 而这一整块只是**入参形状**（含每条字段的"为什么这样传"），与渲染逻辑没有耦合。
 * 搬迁是纯搬移：字段名、注释、可选性与默认值处理（在组件解构处）逐字未变。
 */
import type { RefObject } from "react";
import type { GenerationContextSnapshot } from "../../features/career-scenarios/types";
import type { ResumeContent, ResumeDetail, ResumeLanguage, ResumeLayout } from "../../types";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import type { PathRemap } from "../../features/resume-outline/paths";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import type { RichTextEditAdapter } from "./ResumeWorkbenchLiveCanvas";

export interface ResumeZoomModalProps {
  open: boolean;
  html: string;
  warnings: string[];
  /** 与记录里的页数上限一致；预览里那几根虚线就是按它切的。 */
  pages: number;
  onClose: () => void;
  /** 版式控件（与主预览同一份状态）：在制作台里也能边走边调。 */
  layout?: ResumeLayout;
  resumeId?: number;
  /** 记录标题：冲突时"另存副本"以它为基准加（副本）。 */
  resumeTitle?: string;
  resumeLanguage?: ResumeLanguage;
  relayouting?: boolean;
  /** 这份简历有没有照片：没有时照片滑杆禁用并说明原因（与外面的主预览一致）。 */
  hasPhoto?: boolean;
  /** W14 文档模式（只读挂载到左栏参数栏）：普通简历 / 长 CV。 */
  documentMode?: "resume" | "long_cv";
  /** 当前排版结果页数（文档模式的预算说明用）；null = 还没量到。 */
  pagesNeeded?: number | null;
  onApplyLayout?: (next: ResumeLayout) => void;
  /**
   * 版式落库（老宿主那条 `PATCH /resumes/{id}/layout`）。返回 `false` = 没落库。
   * 有 `documentPipeline` 时走条件写通道，这条只在没有版本能力的宿主里使用。
   */
  onCommitLayout?: () => Promise<boolean>;
  /**
   * W02 条件写通道（宿主注入）：版式 / 正文 / 草稿发布三笔写入都带 `expectedRevision`，
   * 409 时进冲突态并提供"用最新的 / 比较差异 / 另存副本"。
   */
  documentPipeline?: ResumeDocumentPipeline;
  /**
   * 宿主的版式 PATCH 在飞（底部那颗「保存」点下去之后）。
   *
   * 那段时间里 `onCommitLayout` 会返回 `false`（同一时刻不许发两次 PATCH），顶部「保存修改」
   * 若还能点，用户看到的只是"按钮点不动、界面没变"——内容却一次都没存。所以直接禁用。
   */
  layoutSaving?: boolean;
  onExport?: () => void;
  previewRef?: RefObject<ResumePreviewHandle | null>;
  /**
   * 制作台与主预览**共用同一份口径**（2026-10-21 用户要求）：主预览在草稿，制作台就是
   * 草稿；主预览在精确，制作台就是精确。切换也双向同步。
   */
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 精确预览所需的上下文（与外面的那一份逐字段相同）。 */
  exactPreview?: ExactPreviewOptions;
  /**
   * 中栏编辑：这份简历当前**已保存**的内容。
   *
   * 缺省（或没给 `onSaveContent`）时中栏不渲染——生成流程的只读预览、窄屏都走这条路。
   */
  content?: ResumeContent | null;
  /**
   * 中栏保存（老宿主，无版本条件写）：PATCH 后由宿主 setDetail + 重渲染，右栏按新内容重排。
   * 返回保存后的 revision 时，制作台把它当作下一次条件写的基准。
   */
  onSaveContent?: (content: ResumeContent, expectedRevision?: number) => Promise<number | void>;
  /**
   * 中栏是否有未保存的内容：宿主据此禁用底部「手动调整」（两个编辑器同时开会在草稿上
   * 互相覆盖，见设计 §9 Q6）。
   */
  onEditorDirtyChange?: (dirty: boolean) => void;
  /**
   * 「从我的资料追加一条」的候选：中栏与「手动调整」弹窗**同一份实现**。
   * `null`（或还没取到资料）时中栏里没有这条入口，其余功能照旧。
   */
  fillSources?: ProfileFillSources | null;
  /**
   * 这份记录还是**制作台草稿**（0051）：没保存过，所以简历中心里还看不到它。
   *
   * 有了它，「保存」就不能只在"有改动"时出现——草稿刚建出来时内容与版式都没动过，
   * 按钮不出现用户就没有任何办法让它进入简历中心（那正是这条需求要消灭的现象）。
   */
  isDraft?: boolean;
  /** 草稿里什么都没脏时点「保存到简历中心」走这条：宿主发一次内容 PATCH 清掉草稿标记。 */
  onPublishDraft?: () => Promise<boolean>;
  richEdit?: RichTextEditAdapter; // 右键加粗契约（右栏纸面用）；不传 = 右键交给浏览器
  liveContent?: ResumeContent | null; // 右栏实时预览吃的正文（叠加了未保存的加粗）
  richDirty?: boolean; // 纸面加粗还没保存：参与脏值与关闭确认
  onDiscardRichText?: () => void; // 丢掉这些 overlay（取消修改 / 放弃并关闭）
  /**
   * 加粗 overlay 的合并函数（宿主的 `overlays.merge`）。
   *
   * 中栏改内容时草稿要先叠上加粗再送预览：不叠的话"在纸面上加了粗、又在编辑器里改了一句话"
   * 会让加粗凭空消失（草稿里没有 overlay）。
   */
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  /** 画布容器节点的出口（W06 大纲往 iframe 注入选中高亮时要用）。 */
  canvasContainerRef?: RefObject<HTMLDivElement | null>;
  /** W06 结构命令后：宿主把加粗 overlay / 事实标注的 path 换到新下标。 */
  onRemapPaths?: (remap: PathRemap) => void;
  /** 服务端已有新版本（如表达资产插入）：宿主用它刷新 detail/html 与 revision。 */
  onDocumentSynced?: (detail: ResumeDetail) => void;
  /** A6：这份简历生成时冻结的职业场景快照（只读展示；旧记录为 null = 未记录）。 */
  contextSnapshot?: GenerationContextSnapshot | null;
}
