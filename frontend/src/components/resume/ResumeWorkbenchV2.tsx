// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」v2 外壳（2026-10-30 文档模型 v2 重写）。
 *
 * 数据流（唯一一条）：
 * - 中栏 DocumentEditor 受控编辑一份 ResumeDocument；每次改动经 onChange 交给
 *   useWorkbenchV2History（快照 = {document, layout}，撤销/恢复同时还原正文与版式）；
 * - 右栏 ResumeWorkbenchV2Canvas 用同一份文档做防抖实时重排（精确预览按同一份正文排 PDF）；
 * - 左栏 WorkbenchParamsColumnV2 改版式（layout，即时重排）与结构/条目排版（直接提交新文档）；
 * - 顶部保存走宿主注入的 ResumeDocumentPipeline（条件写，409 进冲突条），先版式后正文。
 *
 * 已删除的 v1 机制：antd 表单 + 编辑器句柄、草稿 store、纸面加粗 overlay、大纲命令/路径重映射、
 * v1 field_layout 面板。
 */
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeDetail } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import {
  asResumeDocument,
  documentName,
  layoutFromDetail,
} from "../../features/resume-document/resumeDocumentHost";
import { useOpenLayoutBaseline } from "../../features/resume-document/useOpenLayoutBaseline";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useResumeTemplateCatalog } from "../../hooks/useResumeTemplateCatalog";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumePreviewHandle } from "../ResumePreview";
import WorkbenchColumnsBody from "./WorkbenchColumnsBody";
import WorkbenchModalFrame from "./WorkbenchModalFrame";
import WorkbenchPanelsDrawer from "./WorkbenchPanelsDrawer";
import ResumeWorkbenchActionBar from "./ResumeWorkbenchActionBar";
import ScenarioContextBar from "./ScenarioContextBar";
import ResumeWorkbenchConflict from "./ResumeWorkbenchConflict";
import ResumeWorkbenchV2EditorColumn from "./ResumeWorkbenchV2EditorColumn";
import ResumeWorkbenchV2Canvas from "./ResumeWorkbenchV2Canvas";
import WorkbenchParamsColumnV2 from "./WorkbenchParamsColumnV2";
import PhraseLibraryPanelV2 from "./assets/PhraseLibraryPanelV2";
import SourceChainPanelV2 from "./sources/SourceChainPanelV2";
import BilingualWorkspaceV2 from "./bilingual/BilingualWorkspaceV2";
import ProfileFillMenu from "./ProfileFillMenu";
import { useAssetCollect } from "../../features/resume-assets/useAssetCollect";
import PreflightModal from "./preflight/PreflightModal";
import VersionsModal from "./versions/VersionsModal";
import type { VersionRestoreOut } from "../../features/resume-versions/types";
import { useWorkbenchV2Shortcuts } from "./useWorkbenchV2Shortcuts";
import { useWorkbenchV2Preflight } from "./useWorkbenchV2Preflight";
import { useWorkbenchColumns } from "./useWorkbenchColumns";
import { useWorkbenchV2History } from "./useWorkbenchV2History";
import { useWorkbenchSelectionSync } from "./useWorkbenchSelectionSync";
import { useWorkbenchV2Save } from "./useWorkbenchV2Save";
import { useWorkbenchCloseGuard } from "./useWorkbenchCloseGuard";
import { useStructureHighlightTargets } from "./structure/useStructureHighlightTargets";
import "./workbench-v2.css";
import type { ResumeWorkbenchV2Props } from "./resumeWorkbenchV2Props";

// 既有引用方从这里 import 类型，保持原路径可用。
export type { ResumeWorkbenchV2Props };

export default function ResumeWorkbenchV2({
  open,
  html,
  warnings,
  pages,
  onClose,
  layout,
  resumeId,
  resumeTitle,
  resumeLanguage,
  relayouting = false,
  hasPhoto,
  pagesNeeded,
  onApplyLayout,
  onCommitLayout,
  documentPipeline,
  layoutSaving = false,
  onExport,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  document,
  onSaveContent,
  onEditorDirtyChange,
  isDraft = false,
  onPublishDraft,
  conversion = null,
  fieldCatalog = null,
  documentMode,
  onDocumentModeSaved,
  onAdoptDocument,
  contextSnapshot = null,
  factAnnotations = null,
  rationale = null,
}: ResumeWorkbenchV2Props) {
  useLocale();
  const { message } = App.useApp();
  const { catalog } = useResumeTemplateCatalog();
  const fallbackPreviewRef = useRef<ResumePreviewHandle>(null);
  const workbenchPreviewRef = previewRef ?? fallbackPreviewRef;
  const [canvasNode, setCanvasNode] = useState<HTMLElement | null>(null);
  const columns = useWorkbenchColumns();
  const [openPanel, setOpenPanel] = useState<"params" | "content" | null>(null);
  // 选中态（R-14）：selectedPath / 多选 / hover / 两个定位 nonce 收进一个 hook，
  // 组件里只保留"哪个来源"的判定。多选 = 样式页签的批量目标，同时喂给结构树与排版面板。
  const selection = useWorkbenchSelectionSync(`${resumeId ?? ""}|${open ? "open" : "closed"}`);
  const { selectedPath, multiSelectedPaths, hoverPath, selectPath } = selection;
  const [sourceAdoptOpen, setSourceAdoptOpen] = useState(false);
  const [conversionDismissed, setConversionDismissed] = useState(false);
  // #19：右键「收藏当前要点」的宿主接线（与资产库头部快捷同一套 API / Toast / 刷新）。
  const { collectAsset, refreshToken: phraseRefreshToken } = useAssetCollect(resumeId);
  const baseline = useOpenLayoutBaseline(open, layout);
  // 只读宿主（生成流程未保存预览）可能没有 content：中栏与实时预览不启动，
  // 也不把 v1 结构写进 v2 保存链路；HTML 预览照常渲染。
  const safeDocument = useMemo(() => asResumeDocument(document), [document]);
  const editorEnabled = Boolean(safeDocument && layout);
  const history = useWorkbenchV2History({
    resumeId,
    document: safeDocument,
    layout,
    onApplyLayout,
  });
  const save = useWorkbenchV2Save({
    open,
    document: history.document,
    serverDocument: safeDocument,
    layout: history.layout,
    onApplyLayout,
    documentPipeline,
    onSaveContent,
    onCommitLayout,
    onPublishDraft,
    isDraft,
    onResetDocument: () => {
      if (safeDocument) history.resetDocument(safeDocument, layout);
    },
    onRestoreLayout: (opening) => {
      // 历史快照与宿主一起回到打开时的版式：history.layout 是脏值判据的唯一来源。
      if (safeDocument) history.resetDocument(safeDocument, opening);
      onApplyLayout?.(opening);
    },
  });
  // 保存成功之后旧简历转换提示自动收起（宿主也会把 document_conversion 置空）。
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !save.saving && !save.conflict && !save.saveFailed)
      setConversionDismissed(true);
    wasSaving.current = save.saving;
  }, [save.conflict, save.saveFailed, save.saving]);
  useEffect(() => {
    onEditorDirtyChange?.(save.dirty);
  }, [onEditorDirtyChange, save.dirty]);
  // 纸面点击 → 选中字段（中栏 DocumentEditor 自动切页签并定位；右栏不再二次滚动）。
  const pickFromPaper = selection.pickFromPaper;
  // Q03：全站快捷键体系（设置页可改键；输入框内 undo/redo 让给浏览器原生）。
  useWorkbenchV2Shortcuts({
    undo: history.undo,
    redo: history.redo,
    enabled: open && editorEnabled,
  });
  // Q01：统一检查（W11）入口；草稿正文与版式按眼前这一版送检。
  const preflight = useWorkbenchV2Preflight({
    resumeId,
    document: history.document,
    layout: history.layout,
    onApplyLayout: history.recordLayout,
    onPreviewModeChange,
    focusField: pickFromPaper,
    documentMode,
  });
  // Q01：版本与变体（W13）入口；恢复后宿主与历史基线一起换成服务端返回的新版本。
  const [versionsOpen, setVersionsOpen] = useState(false);
  const handleVersionRestored = useCallback(
    (result: VersionRestoreOut) => {
      const restored = result.resume as unknown as ResumeDetail;
      const nextDocument = asResumeDocument(restored.content);
      if (!nextDocument) return;
      const nextLayout = layoutFromDetail(restored);
      onAdoptDocument?.(nextDocument, result.revision);
      history.resetDocument(nextDocument, nextLayout);
      onApplyLayout?.(nextLayout);
    },
    [history, onAdoptDocument, onApplyLayout],
  );
  // 编辑器 hover / 选中 → 右栏对应行描边（两档分层的接线见 useStructureHighlightTargets）。
  useStructureHighlightTargets({
    selectedPath,
    hoverPath,
    container: canvasNode,
    // 纸面点击不滚纸面：`canvasReveal` 只由结构树 / 中栏 / 面板来源写入。
    reveal: selection.canvasReveal,
  });
  const closeGuard = useWorkbenchCloseGuard({
    dirty: save.dirty,
    layoutDirty: save.layoutDirty,
    editorDirty: save.documentDirty,
    isDraft,
    cancel: save.cancel,
    invalidateDocument: save.invalidateDocument,
    onClose,
  });
  /** 页签组件"只进工作台、不落库"的文档替换（进历史、标脏；不碰宿主 detail）。 */
  const applyDocumentFromPanel = useCallback(
    (next: ResumeDocument, label?: string) => {
      history.commitDocument(next, label);
    },
    [history],
  );
  /** 页签组件"服务端已落库"的文档替换：宿主刷新 detail/html，历史基线对齐到新文档。 */
  const adoptDocumentFromPanel = useCallback(
    (next: ResumeDocument, revision: number) => {
      onAdoptDocument?.(next, revision);
      history.resetDocument(next, history.layout);
    },
    [history, onAdoptDocument],
  );
  // 表达资产 / 来源页签（组件只读 document + 回调，不自己写库；见各 owner 的契约）。
  const assetsPanel =
    resumeId && safeDocument ? (
      <PhraseLibraryPanelV2
        resumeId={resumeId}
        document={history.document}
        layout={history.layout}
        revision={documentPipeline?.revision ?? null}
        selectedPath={selectedPath}
        onInsertDocument={adoptDocumentFromPanel}
        onSelectPath={(path) => selectPath(path, "editor")}
        onApplyDocument={applyDocumentFromPanel}
        refreshToken={phraseRefreshToken}
      />
    ) : null;
  /**
   * 双语采纳只写**语言变体**（不推进简历 revision）：按 Lead 冻结口径，不替换工作台主文档、
   * 不改宿主 detail、不 reset 历史。BilingualWorkspaceV2 内部会刷新变体/候选并 toast
   * 「已采纳到译文变体」；查看译文走只读预览（export-input），不在工作台替换主稿。
   */
  const handleVariantAdopted = useCallback(() => {
    // 刻意留空：界面状态由 BilingualWorkspaceV2 自己刷新。
  }, []);
  const bilingualPanel =
    resumeId && safeDocument ? (
      <BilingualWorkspaceV2
        resumeId={resumeId}
        document={history.document}
        layout={history.layout}
        revision={documentPipeline?.revision ?? null}
        onAdoptDocument={handleVariantAdopted}
      />
    ) : null;
  const sourcesPanel =
    resumeId && safeDocument ? (
      <SourceChainPanelV2
        resumeId={resumeId}
        resumeTitle={resumeTitle}
        document={history.document}
        revision={documentPipeline?.revision ?? null}
        selectedPath={selectedPath}
        hasUnsavedChanges={save.dirty}
        onAdoptFlowChange={setSourceAdoptOpen}
        onApplyDocument={applyDocumentFromPanel}
        onAdoptDocument={adoptDocumentFromPanel}
      />
    ) : null;
  const twoColumn = useMediaQuery("(max-width: 1280px)");
  const oneColumn = useMediaQuery("(max-width: 1000px)");
  const tier: "three" | "two" | "one" = oneColumn ? "one" : twoColumn ? "two" : "three";
  const hasSettings = Boolean(layout && onApplyLayout);
  const showParamsColumn = hasSettings && tier !== "one";
  const showEditorColumn = editorEnabled && tier === "three";
  const showConversion = Boolean(conversion) && !conversionDismissed;

  const editorColumn = editorEnabled ? (
    <div className="resume-wb-col resume-wb-col-editor">
      <ResumeWorkbenchV2EditorColumn
        document={history.document}
        onChange={history.recordDraft}
        selectedPath={selectedPath}
        onSelectPath={(path) => selectPath(path, "editor")}
        onHoverPath={selection.setHoverPath}
        // R-14：任何来源的选中都让中栏滚到对应条目（纸面点击也滚，因为页签可能刚切过去）。
        revealNonce={selection.editorReveal?.nonce ?? 0}
        readOnly={sourceAdoptOpen}
        fieldCatalog={fieldCatalog}
        layout={history.layout}
        onLayoutChange={history.recordLayout}
        conversion={showConversion ? conversion : null}
        onDismissConversion={() => setConversionDismissed(true)}
        onCollectAsset={(path) => void collectAsset(path)}
        factAnnotations={factAnnotations}
        fillMenu={
          resumeId && safeDocument ? (
            <ProfileFillMenu
              document={history.document}
              onChange={history.recordDraft}
              // 当前聚焦条目：菜单据此过滤/禁用跨分区候选（与画布/结构面板共用同一选中状态）。
              selectedPath={selectedPath}
            />
          ) : null
        }
      />
    </div>
  ) : null;
  const paramsColumn = hasSettings ? (
    <WorkbenchParamsColumnV2
      layout={history.layout}
      baseline={baseline ?? history.layout}
      relayouting={relayouting}
      catalog={catalog}
      hasPhoto={hasPhoto}
      previewRef={workbenchPreviewRef}
      tier={tier}
      editorEnabled={editorEnabled}
      // Q09 的「切到精确预览」需要读/写预览口径：与右栏画布同一份受控状态。
      previewMode={previewMode}
      onPreviewModeChange={onPreviewModeChange}
      onChange={history.recordLayout}
      document={history.document}
      onDocumentChange={(next) => history.commitDocument(next)}
      selectedPath={selectedPath}
      // 结构树也走同一个 selectPath(path, "structure")：定位出口已经收敛到
      // useWorkbenchSelectionSync 的 canvasReveal 一处（useStructurePanel 只做高亮、
      // 不再自己滚一份），所以这里只需把来源标成 structure。
      onSelectPath={(path) => selectPath(path, "structure")}
      multiSelectedPaths={multiSelectedPaths}
      onMultiSelectedPathsChange={selection.setMultiSelectedPaths}
      pickTarget={selectedPath ? { path: selectedPath, nonce: selection.pickNonce } : null}
      canvasContainer={canvasNode}
      history={history.historyTab}
      fieldCatalog={fieldCatalog}
      profileSectionOrder={catalog?.profile_section_order}
      onNotify={(text) => message.info(text)}
      pagesNeeded={pagesNeeded}
      resumeId={resumeId ?? null}
      revision={documentPipeline?.revision ?? null}
      // #24 接线：中栏正文的草稿脏也计入左栏「未保存」（版式脏由左栏自己判）。
      dirty={save.dirty}
      rationale={rationale}
      documentMode={documentMode}
      onDocumentModeSaved={onDocumentModeSaved}
      layoutSaving={layoutSaving}
      assetsPanel={assetsPanel}
      sourcesPanel={sourcesPanel}
      bilingualPanel={bilingualPanel}
    />
  ) : null;
  const conflictBar =
    save.conflict && documentPipeline && resumeId != null && editorEnabled ? (
      <ResumeWorkbenchConflict
        resumeId={resumeId}
        resumeTitle={resumeTitle ?? documentName(history.document)}
        resumeLanguage={resumeLanguage ?? layout?.language}
        readLocalContent={() => history.document}
        readLocalDocument={() => history.document}
        saveAsCopy={(content) => documentPipeline.saveAsCopy(content)}
        onAdoptLatest={async (latest) => {
          await documentPipeline.adoptLatest(latest);
          history.resetDocument(latest.content, layoutFromDetail(latest));
        }}
        onResolved={save.settleConflict}
      />
    ) : null;
  const body = (
    <WorkbenchColumnsBody
      bodyRef={columns.containerRef}
      columns={columns}
      hasSettings={hasSettings}
      editorEnabled={editorEnabled}
      showParamsColumn={showParamsColumn}
      showEditorColumn={showEditorColumn}
      paramsColumn={paramsColumn}
      editorColumn={editorColumn}
      conflictBar={conflictBar}
    >
      <ResumeWorkbenchV2Canvas
        html={html}
        warnings={warnings}
        pages={pages}
        previewRef={workbenchPreviewRef}
        previewMode={previewMode}
        onPreviewModeChange={onPreviewModeChange}
        exactPreview={exactPreview}
        onPickField={editorEnabled ? pickFromPaper : undefined}
        // Q05：画布跟着**未保存**的正文走（与编辑器/结构/分页同一份 `history.document`）。
        // 只读宿主（没有 v2 文档或没有版式）保持不启动实时预览：传 null 是"没有可编辑正文"。
        document={editorEnabled ? history.document : null}
        layout={history.layout}
        suspended={save.saving || layoutSaving}
        // Q11：实时渲染要带上文档模式，否则长 CV 的纸面高度按 `resume` 夹到 3 页，
        // 测量分母随之缩到 3/10，「7 页内容」被算成「约需 21 页」。
        documentMode={documentMode}
        onContainerReady={setCanvasNode}
      />
    </WorkbenchColumnsBody>
  );
  return (
    <WorkbenchModalFrame
      open={open}
      onCancel={closeGuard.handleCancel}
      title={
        <ResumeWorkbenchActionBar
          resumeName={documentName(history.document)}
          editorEnabled={editorEnabled}
          dirty={save.dirty}
          isDraft={isDraft}
          conflict={save.conflict}
          saveFailed={save.saveFailed}
          layoutSaving={layoutSaving}
          saving={save.saving}
          discardConfirm={save.discardConfirm}
          closeConfirmOpen={closeGuard.closeConfirmOpen}
          closeBody={closeGuard.closeBody}
          onSave={() => void save.save()}
          onRequestDiscardConfirm={save.setDiscardConfirm}
          onDiscard={closeGuard.cancelAll}
          onExport={onExport}
          onOpenPreflight={editorEnabled ? preflight.openPreflight : undefined}
          onOpenVersions={resumeId != null ? () => setVersionsOpen(true) : undefined}
          onResetColumnWidths={
            tier === "three" && showParamsColumn && showEditorColumn ? columns.reset : undefined
          }
          onOpenContent={
            editorEnabled && tier !== "three" ? () => setOpenPanel("content") : undefined
          }
          onOpenParams={hasSettings && tier === "one" ? () => setOpenPanel("params") : undefined}
          onCloseRequest={closeGuard.handleCloseRequest}
          onCloseConfirmed={closeGuard.confirmDiscardAndClose}
        />
      }
    >
      <ScenarioContextBar snapshot={contextSnapshot}>{body}</ScenarioContextBar>
      <WorkbenchPanelsDrawer
        openPanel={openPanel}
        onClose={() => setOpenPanel(null)}
        editorEnabled={editorEnabled}
        hasSettings={hasSettings}
        editor={editorColumn}
        params={paramsColumn}
      />
      {/* Q01：统一检查与版本/变体入口恢复。两者都是只读报告/列表；修复动作走已有草稿，不写库。 */}
      <PreflightModal open={preflight.open} onClose={preflight.close} {...preflight.modalProps} />
      <VersionsModal
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        resumeId={resumeId ?? undefined}
        currentRevision={documentPipeline?.revision ?? undefined}
        currentContent={history.document}
        onRestored={handleVersionRestored}
      />
    </WorkbenchModalFrame>
  );
}
