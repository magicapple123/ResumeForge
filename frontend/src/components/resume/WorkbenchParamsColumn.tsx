// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」左栏：顶部「排版参数 / 文档大纲」切换，排版页里是模板 / 版式 / 板块顺序 /
 * 字号 / 行距 / 页边距 / 间距 / 局部排版。
 *
 * **为什么单独成文件**：`ResumeZoomModal` 已贴住单文件 500 行预算（那是零豁免的硬约束），
 * 而这一栏的每个分组、每个控件、以及"内容栏不在栅格里时的那句提示"全都可以原样透传。
 * 这一层只多两件**本地状态**：左栏切哪个页签（W06）与大纲面板的接线。
 *
 * ## 两个页签
 *
 * - **排版参数**：把副本属性直接写到 `layout`（宿主即时重排、动作条统一保存）；
 * - **文档大纲**（W06）：语义树 + 结构命令（排序 / 复制 / 隐藏 / 锁定）。命令由 `onCommand`
 *   交给宿主写回文档状态，面板自己**不**改内容；传 `readOnly` 或不传 `onCommand` 时自动只读。
 *
 * 顶部先放 W14 的文档模式（普通 / 长 CV）：先**只读挂载**——保存出口要等后端
 * `document_mode` 写入打通再接 `onChange`；只读态由组件自己说明"由整屏动作条统一保存"。
 */
import { App, Segmented } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import type { RefObject } from "react";
import type { ResumeContent, ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { OutlineCommand } from "../../features/resume-outline";
import { t } from "../../i18n";
import DocumentModeSwitch from "./research/DocumentModeSwitch";
import OutlinePanel from "./outline/OutlinePanel";
import RoleStylePanel from "./typography/RoleStylePanel";
import PhraseLibraryContainer from "./assets/PhraseLibraryContainer";
import ObjectStylePanel from "./typography/ObjectStylePanel";
import { modeLimitsFromCatalog, saveDocumentMode } from "../../features/resume-research/api";
import type { ResumeDetail } from "../../types";
import PaginationControls from "./pagination/PaginationControls";
import { pt } from "../../features/resume-provenance/i18n";
import type { OutlineSelection } from "../../features/resume-outline/types";
import HistoryPanel from "./history/HistoryPanel";
import type { WorkbenchHistoryTab } from "./useWorkbenchHistory";
import BilingualWorkspace from "./bilingual/BilingualWorkspace";

import ResumeColorControls from "./ResumeColorControls";
import ResumeMeasureControls from "./ResumeMeasureControls";
import ResumeParamGroup from "./ResumeParamGroup";
import ResumeSpacingControls from "./ResumeSpacingControls";
import ResumeTemplateControls from "./ResumeTemplateControls";

/** 左栏页签：排版参数 / 文档大纲（W06）/ 表达资产（W17）/ 双语版本（W16）。 */
type LeftTab = "params" | "outline" | "phrases" | "bilingual" | "sources" | "history";

interface Props {
  /** 这份简历**草稿态**的版式（未保存的改动已经在里面，控件显示的就是它）。 */
  layout: ResumeLayout;
  /**
   * 打开这份简历时的版式快照：每个参数右侧那颗 ↺ 恢复的就是它（不是模板默认值）。
   * 由 `ResumeZoomModal` 在这一屏第一次渲染时捕获，之后不再变化。
   */
  baseline: ResumeLayout;
  /** 宿主正在按新设置重排：控件不禁用（禁用会让用户以为拖不动），只标个忙态。 */
  relayouting: boolean;
  /** 版式目录（宿主取一次后下发，各分组共用一份，避免多次请求）。 */
  catalog?: ResumeTemplateCatalog;
  /** 这份简历有没有照片：没有时照片滑杆禁用并说明原因。 */
  hasPhoto?: boolean;
  /** 右栏那个预览实例：拖动度量/外观参数时用它注入探针 CSS，本地缩放、无网络往返。 */
  previewRef: RefObject<ResumePreviewHandle | null>;
  /**
   * 三档形态。只有 `three`（三栏）时内容栏在栅格里；两栏及以下要在本栏里给一句
   * "内容栏去哪了"的提示，否则用户会以为编辑入口消失了。
   */
  tier: "three" | "two" | "one";
  /** 中栏能否编辑（没有 `onSaveContent` 的只读宿主里为 false）：那句提示只在真能编辑时才说。 */
  editorEnabled: boolean;
  /** 任一控件改动后的重排回调（宿主负责 setState 重排，不落库）。 */
  onChange: (next: ResumeLayout) => void;
  /** W14 文档模式（只读挂载）：resume 普通简历 / long_cv 长 CV。 */
  documentMode?: "resume" | "long_cv";
  /** 当前排版结果页数（超上限时给一句说明）；null = 还没量到。 */
  pagesNeeded?: number | null;
  /** 当前内容（W06 大纲用；最好含 id，缺 id 时面板内部 ensureIds）。 */
  content?: ResumeContent | null;
  /** 未保存正文（W10 试用预览/测量按"用户眼前这一版"；缺省退回 content）。 */
  draftContent?: ResumeContent | null;
  /** 纸面点击目标：大纲用来反向选中（与中栏定位是同一份 `{path, nonce}`）。 */
  pickTarget?: { path: string; nonce: number } | null;
  /** 右栏画布节点（大纲向其中 iframe 注入选中高亮）。 */
  canvasContainer?: HTMLElement | null;
  /** 大纲结构命令出口；缺省 = 大纲只读（生成流程预览等宿主）。 */
  onOutlineCommand?: (command: OutlineCommand, baseContent: ResumeContent) => void;
  /** 宿主层面强制大纲只读（没有编辑链路时）。 */
  outlineReadOnly?: boolean;
  /** W03 统一历史：不给则不渲染「历史」页签（只读宿主）。 */
  history?: WorkbenchHistoryTab;
  /** W17 表达资产：插入上下文（当前简历 id；null = 按钮禁用）。 */
  resumeId?: number | null;
  /** W02 revision：插入走条件写，409 不覆盖正文。 */
  revision?: number | null;
  /** 插入成功：把后端保存后的内容/revision 交回宿主刷新。 */
  onContentApplied?: (resume: { content: unknown; revision: number }) => void;
  /** 有未保存草稿时锁插入：插入会整份替换服务端内容，可能覆盖本地未保存改动。 */
  insertLocked?: boolean;
  /** 宿主正在保存版式（文档模式保存也走这里，按钮转圈）。 */
  layoutSaving?: boolean;
  /** 文档模式保存成功：把后端夹紧后的真实 page_limit/document_mode 交回宿主刷新。 */
  onDocumentModeSaved?: (detail: ResumeDetail) => void;
  /** W08 条目级分页：当前选中的条目（来自大纲选中）。 */
  paginationEntry?: { id: string; label: string } | null;
  /** W06 大纲选中变化 → W07/W08 上下文面板。 */
  onOutlineSelectionChange?: (selection: OutlineSelection | null) => void;
  /** W07 对象级排版：选中对象 id / 显示名。 */
  selectedObjectId?: string | null;
  selectedObjectLabel?: string;
  /** W12 来源页签内容（宿主 hook 构建；不传 = 不显示该页签）。 */
  sourcesPanel?: ReactNode;
}

export default function WorkbenchParamsColumn({
  layout,
  baseline,
  relayouting,
  catalog,
  hasPhoto,
  previewRef,
  tier,
  editorEnabled,
  onChange,
  documentMode,
  pagesNeeded,
  content,
  draftContent,
  pickTarget,
  canvasContainer,
  onOutlineCommand,
  outlineReadOnly = false,
  history,
  resumeId,
  revision,
  onContentApplied,
  insertLocked = false,
  layoutSaving = false,
  onDocumentModeSaved,
  paginationEntry,
  onOutlineSelectionChange,
  selectedObjectId,
  selectedObjectLabel,
  sourcesPanel,
}: Props) {
  const [tab, setTab] = useState<LeftTab>("params");
  // W08：板块级分页意图作用在哪一栏（条目级等 W03 选择状态上提后再接）。
  const [paginationSection, setPaginationSection] = useState<string | null>(null);
  // W14：文档模式保存（PATCH 是整体替换；成功把后端夹紧值交回宿主并记一步历史）。
  const { message } = App.useApp();
  const [modeSaving, setModeSaving] = useState(false);
  const modeMeta = modeLimitsFromCatalog(catalog);
  const handleDocumentMode = async (patch: { mode: "resume" | "long_cv"; pageLimit: number }) => {
    if (resumeId == null) return;
    setModeSaving(true);
    try {
      const saved = await saveDocumentMode(resumeId, layout, patch, revision);
      onDocumentModeSaved?.(saved);
      if (saved.page_limit !== layout.page_limit) {
        // 只回写页数：document_mode 存在记录上（宿主用 onDocumentModeSaved 刷新），
        // ResumeLayout 里没有这个字段，不在这里硬塞。
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
    <div className="resume-wb-col resume-wb-col-params">
      <Segmented
        block
        size="small"
        value={tab}
        onChange={(value) => setTab(value as LeftTab)}
        options={[
          { value: "params", label: t("responsive.action.params") },
          { value: "outline", label: t("outline.panel.title") },
          { value: "phrases", label: t("assets.panel.title") },
          { value: "bilingual", label: t("bilingual.panel.title") },
          ...(sourcesPanel
            ? [{ value: "sources" as const, label: pt("provenance.panel.title") }]
            : []),
          ...(history ? [{ value: "history" as const, label: t("workbench.history.title") }] : []),
        ]}
      />
      {tab === "params" ? (
        <>
          <DocumentModeSwitch
            mode={documentMode}
            pageLimit={layout.page_limit}
            limits={modeMeta.limits}
            defaultLongCvPageLimit={modeMeta.defaultLongCvPageLimit}
            pagesNeeded={pagesNeeded}
            saving={modeSaving || layoutSaving}
            onChange={(patch) => void handleDocumentMode(patch)}
          />
          <ResumeParamGroup title={t("workbench.group.layout")} storageKey="layout">
            <ResumeTemplateControls
              layout={layout}
              disabled={relayouting}
              catalog={catalog}
              // 制作台**刻意不传** `preferProfileOrder`（P0-5）：卡片的顺序必须等于这份简历的
              // 真实渲染顺序。传了它，卡片会把"没有 section_order 的老简历"按资料顺序显示，
              // 而四个渲染器读的是内置默认——显示与渲染两套，那正是 P0-5 的根因。
              // 新简历要"资料顺序"改成**落库时物化**（后端 `default_section_order_config`），
              // 不再靠 UI 的默认值临时生效。
              // W10 试用：传当前简历与草稿正文，图库可测"我的内容"；采纳写回模板与覆盖。
              resumeId={resumeId ?? null}
              content={draftContent ?? content ?? null}
              onTrialAdopt={({ template, formatConfig }) => {
                // 「采用模板默认」= 真正回到模板默认：清掉具名版式与全部覆盖；
                // 「保留当前覆盖」= 只换模板，format_name/format_config 原样保留。
                const reset = Object.keys(formatConfig ?? {}).length === 0;
                onChange({
                  ...layout,
                  template,
                  format_name: reset ? "" : layout.format_name,
                  format_config: reset ? {} : formatConfig,
                });
              }}
              onChange={onChange}
            />
          </ResumeParamGroup>
          <ResumeParamGroup title={t("workbench.group.measure")} storageKey="measure">
            <ResumeMeasureControls
              layout={layout}
              baseline={baseline}
              disabled={relayouting}
              catalog={catalog}
              previewRef={previewRef}
              hasPhoto={hasPhoto}
              // 分边页边距**只在这里**出现：左栏有纵向空间，四条支路摊开不挤。
              showMarginSides
              // 制作台内**默认展开**（PRD P0-5）：分边控件是「页边距」这一项的解释，紧跟在它的
              // 总滑杆之后；默认收起会让用户先点一次折叠标题才知道它存在。
              // 另两个宿主（主预览、生成配置页）不传这个 prop，仍取缺省 false（见该组件头注释）。
              defaultSidesOpen
              onChange={onChange}
            />
          </ResumeParamGroup>
          <ResumeParamGroup title={t("workbench.group.spacing")} storageKey="spacing">
            <ResumeSpacingControls
              layout={layout}
              baseline={baseline}
              catalog={catalog}
              disabled={relayouting}
              previewRef={previewRef}
              onChange={onChange}
            />
          </ResumeParamGroup>
          <ResumeParamGroup title={t("workbench.group.appearance")} storageKey="appearance">
            <ResumeColorControls
              layout={layout}
              baseline={baseline}
              catalog={catalog}
              disabled={relayouting}
              previewRef={previewRef}
              onChange={onChange}
            />
          </ResumeParamGroup>
          {/* W07 局部排版：角色级属性（姓名 / 板块标题 / 条目标题 / 正文 / 元信息 / 重点文字）。 */}
          <ResumeParamGroup title={t("typography.group.title")} storageKey="typography">
            <RoleStylePanel
              layout={layout}
              catalog={catalog}
              disabled={relayouting}
              previewRef={previewRef}
              onChange={onChange}
            />
          </ResumeParamGroup>
          {/* 只在内容栏不在栅格里时显示（两栏 / 单栏）：告诉用户它去哪了，而不是让他找。
              三栏时这句描述的是不存在的问题（`display: none` 也在管这件事，两处同源）。 */}
          {tier !== "three" && editorEnabled ? (
            <span className="resume-wb-narrow-hint">{t("workbench.narrow.editor")}</span>
          ) : null}
          {selectedObjectId ? (
            <ObjectStylePanel
              layout={layout}
              catalog={catalog}
              objectId={selectedObjectId}
              objectLabel={selectedObjectLabel}
              disabled={relayouting}
              previewRef={previewRef}
              onChange={onChange}
            />
          ) : null}
          <ResumeParamGroup title={t("pagination.group.title")} storageKey="pagination">
            <PaginationControls
              layout={layout}
              onChange={onChange}
              disabled={relayouting}
              sections={catalog?.section_options}
              section={paginationSection}
              onSectionChange={setPaginationSection}
              entry={paginationEntry ?? null}
            />
          </ResumeParamGroup>
        </>
      ) : tab === "outline" ? (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
          <OutlinePanel
            content={content}
            onCommand={onOutlineCommand}
            onSelectionChange={onOutlineSelectionChange}
            pickTarget={pickTarget}
            canvasContainer={canvasContainer}
            readOnly={outlineReadOnly}
          />
        </div>
      ) : tab === "phrases" ? (
        <PhraseLibraryTab
          resumeId={resumeId ?? null}
          revision={revision ?? null}
          pickTarget={pickTarget}
          onContentApplied={onContentApplied}
          insertLocked={insertLocked}
        />
      ) : tab === "sources" && sourcesPanel ? (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
          {sourcesPanel}
        </div>
      ) : tab === "history" && history ? (
        <HistoryPanel {...history} />
      ) : (
        <BilingualTab
          resumeId={resumeId ?? null}
          content={content ?? null}
          language={layout.language ?? "zh-CN"}
        />
      )}
    </div>
  );
}

/**
 * W17 表达资产页签：资产面板先接 mock 数据（W17-BE 未就绪）。复制是真动作；插入 / 收藏
 * 需要"当前选中要点"（W06 选中链路 + 资产接口），未接之前面板自己禁用插入并说明原因。
 */
function PhraseLibraryTab({
  resumeId,
  revision,
  pickTarget,
  onContentApplied,
  insertLocked = false,
}: {
  resumeId: number | null;
  revision: number | null;
  pickTarget?: { path: string; nonce: number } | null;
  onContentApplied?: (resume: { content: unknown; revision: number }) => void;
  insertLocked?: boolean;
}) {
  const section = pickTarget?.path?.split(".")[0] ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
      <PhraseLibraryContainer
        resumeId={resumeId}
        expectedRevision={revision}
        selectedPath={pickTarget?.path ?? null}
        insertTarget={section ? { section } : null}
        insertLocked={insertLocked}
        onInserted={(result) =>
          onContentApplied?.(result.resume as { content: unknown; revision: number })
        }
      />
    </div>
  );
}

/**
 * W16 双语版本页签（真实 API 容器）：变体表 / 字段对照 / 翻译候选 / 术语表都在容器里；
 * 采纳只改**变体**、不覆盖当前语言主稿（lead 已批准的偏差），术语删除=软删 + 撤销。
 */
function BilingualTab({
  resumeId,
  content,
  language,
}: {
  resumeId: number | null;
  content: ResumeContent | null;
  language: "zh-CN" | "en-US";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
      <BilingualWorkspace
        resumeId={resumeId}
        currentContent={(content ?? null) as Record<string, unknown> | null}
        currentLanguage={language}
      />
    </div>
  );
}
