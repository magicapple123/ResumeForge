// SPDX-License-Identifier: Apache-2.0
/** 「简历制作台」整屏外壳：三栏编排、动作条、窄屏降级与各领域挂载点（W02–W17）的接线。 */
import { useCallback, useRef, useState } from "react";
import type { ResumeLayout } from "../../types";
import { createResumeDraftStore } from "../../features/resume/resumeDraftContent";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useResumeTemplateCatalog } from "../../hooks/useResumeTemplateCatalog";
import type { ResumePreviewHandle } from "../ResumePreview";
import ResumeWorkbenchActionBar from "./ResumeWorkbenchActionBar";
import WorkbenchColumnsBody from "./WorkbenchColumnsBody";
import ScenarioContextBar from "./ScenarioContextBar";
import ResumeWorkbenchConflict from "./ResumeWorkbenchConflict";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";
import WorkbenchCanvasColumn from "./WorkbenchCanvasColumn";
import WorkbenchModalFrame from "./WorkbenchModalFrame";
import WorkbenchPanelsDrawer from "./WorkbenchPanelsDrawer";
import WorkbenchParamsColumn from "./WorkbenchParamsColumn";
import PreflightModal from "./preflight/PreflightModal";
import { useWorkbenchCloseGuard } from "./useWorkbenchCloseGuard";
import { useWorkbenchContextPanels } from "./useWorkbenchContextPanels";
import { useWorkbenchColumns } from "./useWorkbenchColumns";
import { useWorkbenchDocumentBridge } from "./useWorkbenchDocumentBridge";
import { useWorkbenchHistory } from "./useWorkbenchHistory";
import { useWorkbenchDocumentCommit } from "./useWorkbenchDocumentCommit";
import { useWorkbenchOutline } from "./useWorkbenchOutline";
import { useWorkbenchPreflight } from "./useWorkbenchPreflight";
import { useWorkbenchProview } from "./useWorkbenchProview";
import { useWorkbenchServerSync } from "./useWorkbenchServerSync";
import { useWorkbenchOverallSave } from "./useWorkbenchOverallSave";
import { useOpenLayoutBaseline } from "../../features/resume-document/useOpenLayoutBaseline";
import type { ResumeZoomModalProps } from "./ResumeZoomModal.types";

export default function ResumeZoomModal({
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
  documentMode,
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
  content,
  onSaveContent,
  onEditorDirtyChange,
  fillSources,
  isDraft = false,
  onPublishDraft,
  richEdit,
  liveContent,
  richDirty,
  onDiscardRichText,
  mergeLive,
  canvasContainerRef,
  onRemapPaths,
  onDocumentSynced,
  contextSnapshot,
}: ResumeZoomModalProps) {
  // 制作台有自己的预览实例：字号滑块要即时作用在**这一个** iframe 上（调用方给了 ref 就用它）。
  const fallbackPreviewRef = useRef<ResumePreviewHandle>(null);
  const workbenchPreviewRef = previewRef ?? fallbackPreviewRef;
  // 右栏容器的节点出口（W06 大纲用）：由本层创建并交给"画布列"挂到 div 上。
  const fallbackCanvasRef = useRef<HTMLDivElement | null>(null);
  const resolvedCanvasRef = canvasContainerRef ?? fallbackCanvasRef;
  // W06 大纲要量右栏位置：容器节点由画布列上报，用 state 持有（渲染期读 ref 非法）。
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);
  // 目录**只取一次**，四个分组共用（`useApi` 没有跨实例缓存，各取一次就是四个请求）。
  const { catalog } = useResumeTemplateCatalog();
  /**
   * 中栏 → 右栏的**单向**草稿通道（P0-7）：在这一层创建、只往下传，**自己不订阅**
   * （订阅在 `ResumeWorkbenchLiveCanvas` 薄壳里，否则每键输入都会重渲染整个三栏弹窗）。
   * 用 `useState` 惰性初始化（ref 不允许在渲染期读取，`react-hooks/refs`）；生命周期
   * 跟随弹窗实例：关掉再开是一份新的（不会带上次的残留草稿）。
   */
  const [draftStore] = useState(createResumeDraftStore);
  // 中栏**不再可折叠**（2026-10-23 用户口径："去掉右上角的收起内容栏按钮"）。理由不只是
  // 少一颗按钮：折叠会把中栏整个卸载，那份未保存的草稿只留在 sessionStorage 里，用户回来
  // 时看到的是"上次的改动不见了"。中栏是这一屏的主场，藏起来只会让人找不到它。
  // 中栏脏值同时上报给宿主（底部「手动调整」要用），这里再留一份，好让关闭前的那次
  // 判断（Esc / × / 遮罩）自己就能决定"要不要问"。
  const [editorDirty, setEditorDirty] = useState(false);
  // 「刚打开这份简历时」的版式快照：左栏每个参数右侧那颗 ↺ 恢复的就是它（实现见 hook）。
  const baseline = useOpenLayoutBaseline(open, layout);
  // 保存中：顶部「保存修改」上 loading，同一时刻「取消修改」禁用（避免保存还没落库就先清掉）。
  const [editorSaving, setEditorSaving] = useState(false);
  // 顶部动作条上的两颗按钮靠这个句柄打到中栏的状态机上（表单实例、脏值、内联确认都在那一层）。
  const editorRef = useRef<ResumeWorkbenchEditorHandle>(null);
  // 「点纸面字段 → 定位中栏输入框」。每次点击换新对象（`nonce` 自增）：同一条路径连点两次
  // 引用也会变，中栏那条 effect 才会重新滚一遍并聚焦（只比路径的话第二次点击毫无反应）。
  const [pickTarget, setPickTarget] = useState<{ path: string; nonce: number } | null>(null);
  const handlePickField = (path: string) =>
    setPickTarget((previous) => ({ path, nonce: (previous?.nonce ?? 0) + 1 }));
  // 三栏宽度：拖动 / 键盘 / 复位 / 持久化都在这个 hook 里（渲染仍归这个文件）。
  const columns = useWorkbenchColumns();
  const { containerRef: bodyRef } = columns;
  const editorEnabled = Boolean(onSaveContent);
  const { handleContentSave, readLocalContent, adoptLatest } = useWorkbenchDocumentBridge({
    documentPipeline,
    onSaveContent,
    editorRef,
    content,
    mergeLive,
    // 中栏未挂载时冲突条要用的"本地那一版"在统一历史里。
    documentContent: () => history.content,
  });
  const history = useWorkbenchHistory({
    resumeId,
    content,
    layout,
    onApplyLayout,
    editorRef,
    onRemapPaths,
    overlays: documentPipeline?.overlays,
    onOverlaysChange: documentPipeline?.onOverlaysChange,
  });
  // 窄档（两栏 / 单栏）下中栏未挂载：结构命令的正文 / 脏值 / 保存 / 放弃出口都在这个 hook 里。
  const documentCommit = useWorkbenchDocumentCommit({
    content,
    documentPipeline,
    editorRef,
    draftStore,
    history,
    handleContentSave,
  });
  // 「有没有改动 / 保存 / 取消 / 就地确认 / 冲突」全在 hook 里：脏值来源是中栏内容、左栏版式、
  // 纸面加粗与窄档的文档正文。加粗必须并进 `editorDirty`——保存只有看到它才会去点中栏的保存。
  const {
    dirty,
    layoutDirty,
    saving,
    conflict,
    saveFailed,
    save,
    cancel,
    settleConflict,
    invalidateDocument,
    discardConfirm,
    setDiscardConfirm,
  } = useWorkbenchOverallSave({
    open,
    layout,
    editorDirty: editorDirty || Boolean(richDirty),
    isDraft,
    editorRef,
    onApplyLayout,
    onCommitLayout,
    documentPipeline,
    onPublishDraft,
    documentContent: documentCommit.bridge,
  });
  // W15 专业视图：命令 / 工作区预设 / 照片入口；裁剪落点复用 history.recordLayout（进历史 + 既有保存链路）。
  const { proview, panels } = useWorkbenchProview({
    resumeId,
    content,
    save,
    onExport,
    onSaveContent,
    layout,
    onApplyLayout: history.recordLayout,
  });
  const serverSync = useWorkbenchServerSync({
    resumeId,
    currentRevision: documentPipeline?.revision,
    currentContent: liveContent ?? content ?? null,
    history,
    onDocumentSynced,
  });
  const outline = useWorkbenchOutline({
    editorRef,
    onRemapPaths,
    commit: documentCommit.outlineCommit,
  });
  // 三档形态（方案 §4.5.6）：three=参数+内容常驻；two=参数常驻+内容进抽屉；one=画布独占+两个抽屉。
  // jsdom 的 `matchMedia` 桩恒 false ⇒ 三栏，既有断言的 DOM 一字不变。
  const twoColumn = useMediaQuery("(max-width: 1280px)");
  const oneColumn = useMediaQuery("(max-width: 1000px)");
  const tier: "three" | "two" | "one" = oneColumn ? "one" : twoColumn ? "two" : "three";
  /** 两个抽屉互斥（同一个状态）：768 宽时两个 378 会把画布全盖住。 */
  const [openPanel, setOpenPanel] = useState<"params" | "content" | null>(null);
  const hasSettings = Boolean(layout && onApplyLayout);
  // 预设只对三栏档生效：两栏/单栏是响应式降级，再叠一层工作区预设会互相打架。
  const presetPanels = tier === "three" ? panels : { params: true, editor: true };
  const showParamsColumn = hasSettings && tier !== "one" && presetPanels.params;
  const showEditorColumn = editorEnabled && tier === "three" && presetPanels.editor;
  const pickFromPaper = (path: string) => {
    if (!showEditorColumn) setOpenPanel("content");
    handlePickField(path);
  };
  // W08/W07 上下文：一份选中同时喂条目级分页、溢出定位与对象级排版；定位复用纸面链路。
  const contextPanels = useWorkbenchContextPanels({
    content: content ?? null,
    resumeId,
    layout,
    draftContent: liveContent ?? content ?? null,
    sectionOptions: catalog?.section_options,
    onLocateField: pickFromPaper,
    onApplyContent: history.commitContent,
  });
  const preflight = useWorkbenchPreflight({
    resumeId,
    content,
    liveContent,
    layout,
    onApplyLayout,
    onPreviewModeChange,
    focusField: pickFromPaper,
  });
  const handleEditorDirty = useCallback(
    (dirty: boolean) => {
      setEditorDirty(dirty);
      onEditorDirtyChange?.(dirty);
    },
    [onEditorDirtyChange],
  );
  // 关闭守卫：× / Esc / 遮罩 / 「放弃并关闭」共用一套语义（判断在 hook 里）。
  const {
    closeConfirmOpen,
    closeBody,
    handleCloseRequest,
    handleCancel,
    confirmDiscardAndClose,
    cancelAll,
  } = useWorkbenchCloseGuard({
    dirty,
    layoutDirty,
    editorDirty,
    isDraft,
    cancel,
    invalidateDocument,
    onDiscardRichText,
    onClose,
  });

  const paramsColumn = hasSettings ? (
    <WorkbenchParamsColumn
      layout={layout as ResumeLayout}
      baseline={baseline ?? (layout as ResumeLayout)}
      relayouting={relayouting}
      catalog={catalog}
      hasPhoto={hasPhoto}
      documentMode={documentMode}
      pagesNeeded={pagesNeeded}
      previewRef={workbenchPreviewRef}
      tier={tier}
      editorEnabled={editorEnabled}
      onChange={history.recordLayout}
      layoutSaving={layoutSaving}
      onDocumentModeSaved={onDocumentSynced}
      {...contextPanels.paramsProps}
      // W06 大纲：内容 + 纸面点击目标 + 右栏节点。
      content={content ?? null}
      draftContent={mergeLive?.(history.content) ?? history.content}
      pickTarget={pickTarget}
      canvasContainer={canvasNode}
      onOutlineCommand={editorEnabled ? outline.command : undefined}
      onStructurePreview={outline.handleStructurePreview}
      outlineReadOnly={!editorEnabled}
      history={editorEnabled ? history.historyTab : undefined}
      resumeId={resumeId ?? null}
      revision={documentPipeline?.revision ?? null}
      onContentApplied={serverSync.handlePhraseInserted}
      insertLocked={dirty}
    />
  ) : null;

  // 内容栏本体：三栏常驻中栏，两栏/单栏搬进抽屉；只写一份 JSX（两处各写一遍必然分叉）。
  const editorColumn = editorEnabled ? (
    <div className="resume-wb-col resume-wb-col-editor">
      <ResumeWorkbenchEditorColumn
        ref={editorRef}
        active
        content={content ?? null}
        resumeId={resumeId}
        fillSources={fillSources}
        relayouting={relayouting}
        onSave={handleContentSave}
        onDirtyChange={handleEditorDirty}
        onSavingChange={setEditorSaving}
        onDraftContent={history.recordDraft}
        keyboardHistory={false}
        // 只上行：中栏把草稿写进 store，右栏订阅它；`content` 永远是服务端那一份。
        draftStore={draftStore}
        // 点右栏纸面上的字段 → 这一栏切标签页 + 滚到对应输入框并聚焦。
        pickTarget={pickTarget}
        // 底部不再有一对局部的保存/取消：整屏顶部那一对是**整体**的（内容 + 排版），
        // 两对并排放着，用户得先猜"这两颗管的是不是同一件事"。
        hideActions
      />
    </div>
  ) : null;
  const body = (
    <WorkbenchColumnsBody
      bodyRef={bodyRef}
      columns={columns}
      hasSettings={hasSettings}
      editorEnabled={editorEnabled}
      showParamsColumn={showParamsColumn}
      showEditorColumn={showEditorColumn}
      paramsColumn={paramsColumn}
      editorColumn={editorColumn}
      conflictBar={
        conflict && documentPipeline && resumeId != null ? (
          <ResumeWorkbenchConflict
            resumeId={resumeId}
            resumeTitle={resumeTitle ?? content?.name ?? ""}
            resumeLanguage={resumeLanguage ?? layout?.language}
            readLocalContent={readLocalContent}
            onAdoptLatest={adoptLatest}
            onResolved={settleConflict}
          />
        ) : null
      }
    >
      <WorkbenchCanvasColumn
        html={html}
        warnings={warnings}
        pages={pages}
        previewRef={workbenchPreviewRef}
        previewMode={previewMode}
        onPreviewModeChange={onPreviewModeChange}
        exactPreview={exactPreview}
        // 勾上「草稿模式编辑」后，右栏纸面点哪里，中栏就跳到哪一栏的输入框。
        onPickField={editorEnabled ? pickFromPaper : undefined}
        // 实时预览优先级在画布里定：结构预览（拖动中）→ 草稿（叠加加粗）→ 宿主已保存 / 已加粗。
        content={outline.preview ?? liveContent ?? content ?? null}
        draftStore={draftStore}
        mergeLive={mergeLive}
        layout={layout}
        richEdit={richEdit}
        suspended={saving || editorSaving}
        containerRef={resolvedCanvasRef}
        onContainerReady={setCanvasNode}
        banner={contextPanels.canvasBanner}
        proview={proview}
      />
    </WorkbenchColumnsBody>
  );
  return (
    <WorkbenchModalFrame
      // Esc / 遮罩与关闭按钮都由外壳统一转发；"直接关还是问一句"的判断在本文件。
      open={open}
      onCancel={handleCancel}
      // 标题节点**就是**动作条：56px 一行放"名字 + 保存/取消 + 导出"。
      title={
        <ResumeWorkbenchActionBar
          resumeName={content?.name}
          editorEnabled={editorEnabled}
          dirty={dirty}
          isDraft={isDraft}
          conflict={conflict}
          saveFailed={saveFailed}
          layoutSaving={layoutSaving}
          editorSaving={editorSaving}
          saving={saving}
          discardConfirm={discardConfirm}
          closeConfirmOpen={closeConfirmOpen}
          closeBody={closeBody}
          onSave={() => void save()}
          onRequestDiscardConfirm={setDiscardConfirm}
          onDiscard={cancelAll}
          onExport={onExport}
          onOpenPreflight={editorEnabled ? preflight.openPreflight : undefined}
          onOpenVersions={serverSync.versions.openVersions}
          // 两栏/单栏档的分隔条本来就不渲染，这里不给一颗无作用的复位图标。
          onResetColumnWidths={
            tier === "three" && showParamsColumn && showEditorColumn ? columns.reset : undefined
          }
          // 两栏及以下：内容栏不在栅格里，必须给一个入口（否则「编辑内容」不可达）。
          onOpenContent={
            editorEnabled && tier !== "three" ? () => setOpenPanel("content") : undefined
          }
          // 单栏：参数栏也不在栅格里了。
          onOpenParams={hasSettings && tier === "one" ? () => setOpenPanel("params") : undefined}
          onCloseRequest={handleCloseRequest}
          onCloseConfirmed={confirmDiscardAndClose}
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
      {serverSync.versions.modalNode}
      {/* W11 统一检查：结果不落库；修复动作走宿主既有入口。 */}
      <PreflightModal open={preflight.open} onClose={preflight.close} {...preflight.modalProps} />
    </WorkbenchModalFrame>
  );
}
