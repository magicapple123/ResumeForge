// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏（v2）：排版参数 / 本份简历结构 / 历史 三个页签。
 *
 * 与旧 WorkbenchParamsColumn 的差别：
 * - 「文档大纲」换成「本份简历结构」（StructurePanel，数据源 v2 document）；
 * - 「条目字段排版」（v1 七分区 FieldLayoutPanel）换成 EntryLayoutPanel（板块来自文档）；
 * - 结构/排版面板直接提交新文档（由工作台记历史），编辑不再经中栏表单句柄。
 *
 * W07 局部排版的角色面板保留（只改 format_config，不碰正文）；对象级/文字级别/分页
 * 等面板依赖 v1 正文字段路径，本批暂不挂在 v2 工作台（见计划执行记录的风险项）。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ReactNode } from "react";
import { DownOutlined } from "@ant-design/icons";
import { Tooltip, Typography } from "antd";
import type { ResumeDetail, ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { DocumentFieldCatalog, ResumeDocument } from "../../types/resumeDocument";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import WorkbenchLeftTabs, { type WorkbenchLeftTabItem } from "./WorkbenchLeftTabs";
import ResumeParamGroup from "./ResumeParamGroup";
import ResumeTemplateControls from "./ResumeTemplateControls";
import ResumeMeasureControls from "./ResumeMeasureControls";
import ResumeSpacingControls from "./ResumeSpacingControls";
import ResumeColorControls from "./ResumeColorControls";
import ResumeLanguageSelect from "./ResumeLanguageSelect";
import ContactBreaksControl from "../../features/resume-layout/ContactBreaksControl";
import HistoryPanel from "./history/HistoryPanel";
import StructurePanel from "./structure/StructurePanel";
import EntryLayoutPanel from "./EntryLayoutPanel";
import DocumentModePanel from "./DocumentModePanel";
import SectionPaginationPanel from "./pagination/SectionPaginationPanel";
import PageThumbnailStrip from "./pagination/PageThumbnailStrip";
import ChipStylePopover, { type ChipStylePopoverState } from "../resume-editor/ChipStylePopover";
import { usePanelScrollAnchor } from "./entryLayout/usePanelScrollAnchor";
import { usePaginationReport } from "../../features/resume-pagination/usePaginationReport";
import { usePaginationReportMarkers } from "../../features/resume-pagination/paginationPageMarkers";
import { setPaginationReportRefresh } from "../../features/resume-pagination/paginationRefreshStore";
import { pageLimitOptions } from "../../features/resume-research/documentMode";
import type { WorkbenchHistoryTab } from "./useWorkbenchV2History";
import "./workbench-v2.css";

type LeftTab = "params" | "structure" | "bilingual" | "assets" | "sources" | "history";

/**
 * 问题 22 ①：「新页」区块（`SectionPaginationPanel`，16 个板块的「从新页开始」开关）默认收起。
 *
 * 为什么放在 `sessionStorage` 而不是 `ResumeParamGroup` 用的 `localStorage`：
 * "这次想看一眼分页"是**这一次编辑**里的动作，不是长期偏好。存 `localStorage` 会让昨天
 * 顺手展开过的人今天一进制作台又是 477px 的开关墙——问题原样复发。会话级存储关掉标签页
 * 就归零，与「本次会话」的语义正好对齐（`ResumeParamGroup` 头注释里那条"分组偏好是人的
 * 属性"不适用于这里：分组偏好是长期习惯，这里是一次性动作）。
 */
const NEW_PAGE_STORAGE_KEY = "resume.wb.newpage.open";

/** 读会话内的展开态：读不到（首次进制作台 / 隐私模式 / 存不下）就按默认**收起**。 */
function readNewPageOpen(): boolean {
  try {
    return window.sessionStorage.getItem(NEW_PAGE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 写会话内的展开态：存不下就只保留组件内 state，不影响渲染。 */
function writeNewPageOpen(open: boolean): void {
  try {
    window.sessionStorage.setItem(NEW_PAGE_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // 隐私模式 / 配额满：折叠态记忆失效不影响功能。
  }
}

export interface WorkbenchParamsColumnV2Props {
  layout: ResumeLayout;
  baseline: ResumeLayout;
  relayouting: boolean;
  catalog?: ResumeTemplateCatalog;
  hasPhoto?: boolean;
  previewRef: RefObject<ResumePreviewHandle | null>;
  tier: "three" | "two" | "one";
  editorEnabled: boolean;
  onChange: (next: ResumeLayout) => void;
  document: ResumeDocument;
  onDocumentChange: (next: ResumeDocument) => void;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  pickTarget?: { path: string; nonce: number } | null;
  canvasContainer?: HTMLElement | null;
  history?: WorkbenchHistoryTab;
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 「我的资料」板块顺序（已翻成文档 key）；结构面板「顺序」里的同步按钮用。 */
  profileSectionOrder?: readonly string[];
  onNotify?: (message: string) => void;
  pagesNeeded?: number | null;
  /** 记录 id：文档模式保存 / 后续双语·资产·来源页签都需要它；null = 只读宿主。 */
  resumeId?: number | null;
  /** 条件写版本号（detail.revision）。 */
  revision?: number | null;
  /** 后端 resume_record.document_mode。 */
  documentMode?: "resume" | "long_cv";
  /** 文档模式保存成功：宿主用最新详情刷新 detail/html/revision。 */
  onDocumentModeSaved?: (detail: ResumeDetail) => void;
  /** 版式保存/重排在飞（文档模式控件的禁用口径）。 */
  layoutSaving?: boolean;
  /** 预览口径（宿主控制）：分页面板的「切到精确预览」只在拿到它时渲染。 */
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 双语 / 表达资产 / 来源页签的宿主挂载点（组件由各 owner 交付后由 shell 构造）。 */
  bilingualPanel?: ReactNode;
  assetsPanel?: ReactNode;
  sourcesPanel?: ReactNode;
  /**
   * U7 结构树多选：宿主持有的条目路径（结构页签勾选 ↔ 样式页签批量目标同源）。
   * 不传 = 结构树不渲染勾选框。
   */
  multiSelectedPaths?: string[];
  onMultiSelectedPathsChange?: (paths: string[]) => void;
}

export default function WorkbenchParamsColumnV2({
  layout,
  baseline,
  relayouting,
  catalog,
  hasPhoto,
  previewRef,
  tier,
  editorEnabled,
  onChange,
  document,
  onDocumentChange,
  selectedPath,
  onSelectPath,
  pickTarget,
  canvasContainer,
  history,
  fieldCatalog,
  profileSectionOrder,
  onNotify,
  pagesNeeded,
  resumeId,
  revision,
  documentMode,
  onDocumentModeSaved,
  layoutSaving = false,
  previewMode,
  onPreviewModeChange,
  bilingualPanel,
  assetsPanel,
  sourcesPanel,
  multiSelectedPaths,
  onMultiSelectedPathsChange,
}: WorkbenchParamsColumnV2Props) {
  useLocale();
  const [tab, setTab] = useState<LeftTab>("params");
  /**
   * #7：结构树条目行右键「排版整条…」的浮层状态。浮层与画布条目卡复用的是同一个
   * `ChipStylePopover`（范围由路径推出：条目路径 = 整条 → `objects[<entryId>]`）。
   */
  const [entryStyleRequest, setEntryStyleRequest] = useState<ChipStylePopoverState | null>(null);
  /** R-10：结构页签面板的滚动锚定（改动后重排时把 scrollTop 写回去，内容不上下跳）。 */
  const structureScrollRef = usePanelScrollAnchor<HTMLDivElement>(document);
  /**
   * 问题 22 ①：「新页」区块的展开态（默认收起，会话内记住）。
   *
   * 收起时把整块从 DOM 里摘掉而不是 `display: none`：16 个 antd `Switch` 仍然挂着
   * 会白白吃 16 份 `useState` 与 mousemove 监听，而"收起"的收益正是别为它们付成本。
   */
  const [newPageOpen, setNewPageOpen] = useState<boolean>(readNewPageOpen);
  /** `aria-controls` 指向的展开体 id：同一屏可能挂两份左栏（整屏弹窗 + 窄屏宿主），用 `useId` 防撞。 */
  const newPageBodyId = useId();
  const toggleNewPage = useCallback(() => {
    setNewPageOpen((prev) => {
      const next = !prev;
      writeNewPageOpen(next);
      return next;
    });
  }, []);
  /** 收起态那一行的摘要：「分页：N 个板块设了新页」，0 个时换一句空的说法。 */
  const newPageBreakCount = useMemo(
    () => document.sections.filter((section) => section.layout.start_on_new_page).length,
    [document.sections],
  );
  /** 整列（`.resume-wb-v2-params`）是滚动容器：切页签时要把它的 scrollTop 归零。 */
  const columnRef = useRef<HTMLDivElement>(null);
  const changeTab = useCallback((next: LeftTab) => {
    setTab(next);
    // R-28：上一页签滚到一半的位置会带到下一页签（页签条吸顶后尤其明显——
    // 新页签的第一屏是"从中间开始"的）。切页签即回到顶部。
    const column = columnRef.current;
    if (column) column.scrollTop = 0;
  }, []);
  const buildPaginationRequest = useCallback(() => {
    // `0` = 「不限篇幅」，必须原样发出去（后端 `PreviewPdfRequest.page_limit` 收 0）。
    // 旧写法 `Number(...) || 1` 把不限折成 1 页：面板于是按 1 页排，屏幕上"实际 1 页"、
    // 导出却是完整多页。只有**非数字**才回落到 1。
    const limit = Number(layout.page_limit);
    return {
      template: layout.template,
      format_name: layout.format_name,
      page_limit: Number.isFinite(limit) ? limit : 1,
      font_scale: layout.font_scale,
      language: layout.language,
      format_config: layout.format_config as Record<string, unknown>,
      content: document,
    };
  }, [document, layout]);
  const pagination = usePaginationReport({
    resumeId: resumeId ?? null,
    buildRequest: buildPaginationRequest,
  });
  usePaginationReportMarkers(pagination.report);
  const latestPaginationRun = useRef(pagination.run);
  useEffect(() => {
    latestPaginationRun.current = pagination.run;
  }, [pagination.run]);
  const triggerPaginationReport = useCallback(() => {
    void latestPaginationRun.current();
  }, []);
  useEffect(() => {
    if (resumeId == null) return;
    setPaginationReportRefresh(triggerPaginationReport);
    return () => setPaginationReportRefresh(null);
  }, [resumeId, triggerPaginationReport]);
  const tabs = useMemo<WorkbenchLeftTabItem<LeftTab>[]>(() => {
    const items: WorkbenchLeftTabItem<LeftTab>[] = [
      { value: "params", label: t("responsive.action.params") },
      { value: "structure", label: t("structure.panel.title") },
    ];
    if (bilingualPanel) items.push({ value: "bilingual", label: t("bilingual.panel.title") });
    if (assetsPanel) items.push({ value: "assets", label: t("assets.panel.title") });
    if (sourcesPanel) items.push({ value: "sources", label: t("provenance.panel.title") });
    if (history) items.push({ value: "history", label: t("workbench.history.title") });
    return items;
  }, [assetsPanel, bilingualPanel, history, sourcesPanel]);
  return (
    <div ref={columnRef} className="resume-wb-col resume-wb-col-params resume-wb-v2-params">
      {/*
        #7：结构树右键「排版整条…」的浮层。挂在整列（不随页签卸载），关掉即清空；
        layout / catalog / onChange 都是本组件已有的 props，浮层自己按路径锁范围。
      */}
      <ChipStylePopover
        state={entryStyleRequest}
        document={document}
        layout={layout}
        catalog={catalog}
        onClose={() => setEntryStyleRequest(null)}
        onLayoutChange={onChange}
      />
      <WorkbenchLeftTabs<LeftTab>
        ariaLabel={t("workbench.leftTabs.label")}
        value={tab}
        onChange={changeTab}
        items={tabs}
      />
      {tab === "params" ? (
        <>
          {/* T7d：左栏按 v2 语义收成三组——模板（shell+CSS）/ 版面（篇幅+分页+诊断）/ 样式（字体字号行距边距颜色+局部排版）。
              板块顺序、条目字段排版这类**结构**能力全部进「本份简历结构」页签，这里不再挂第二份入口。 */}
          <ResumeParamGroup title={t("workbench.group.template")} storageKey="template">
            <ResumeTemplateControls
              layout={layout}
              disabled={relayouting}
              catalog={catalog}
              showPageLimit={false}
              // 篇幅上限本组不渲染（`showPageLimit={false}`，同一键只留在「版面」组的
              // 文档模式控件里），选项仍按**当前文档模式**给全：普通 1–3 + 不限、
              // 长 CV 1–10 + 不限。缺省的 `RESUME_PAGE_LIMITS`（1–3）没有「不限」档，
              // 一旦有宿主把这一组打开，用户就又选不到 0 了。
              pageLimitOptions={pageLimitOptions(documentMode ?? "resume")}
              // #13：字段语言移进「版面」组（同一键只保留一处），模板组只剩模板 + 版式。
              showLanguage={false}
              // R-03：模板图库里的「试用与对比」要能看「我的内容」并真实测量页数，
              // 采纳「采用模板默认」还要把**清空后的** format_config 一起写回——
              // 三个通道缺一个，对比视图就会退回"只能看示例 / 不能清空覆盖"。
              // 采纳走 onChange（= 工作台历史），所以「用这个模板」整体可撤销一次。
              resumeId={resumeId ?? null}
              content={document}
              onTrialAdopt={({ template, formatConfig }) =>
                onChange({ ...layout, template, format_config: formatConfig })
              }
              onChange={onChange}
            />
          </ResumeParamGroup>
          <ResumeParamGroup title={t("workbench.group.page")} storageKey="page">
            {resumeId ? (
              <DocumentModePanel
                resumeId={resumeId}
                revision={revision ?? null}
                documentMode={documentMode}
                layout={layout}
                catalog={catalog}
                pagesNeeded={pagesNeeded}
                saving={layoutSaving}
                disabled={relayouting || undefined}
                onChange={onChange}
                onSaved={onDocumentModeSaved}
              />
            ) : null}
            {/* #13：字段语言只决定纸面上固定文案（小节标题/字段名）的语种，和篇幅、分页
                同属「版面」；放在文档模式之后，模板组不再为它挤第三行。
                任务 4：与上下三行同一套「标签列 + 控件列」网格，控件左缘落在同一条竖线上。 */}
            <div className="resume-wb-field-row">
              <span className="resume-wb-field-label">{t("resume.language.label")}</span>
              <Tooltip title={t("resume.language.hint")}>
                <span style={{ justifySelf: "start" }}>
                  <ResumeLanguageSelect
                    value={layout.language ?? "zh-CN"}
                    disabled={relayouting || undefined}
                    onChange={(language) => onChange({ ...layout, language })}
                  />
                </span>
              </Tooltip>
            </div>
            <ContactBreaksControl
              formatConfig={layout.format_config}
              disabled={relayouting}
              onChange={(format_config) => onChange({ ...layout, format_config })}
            />
            {/* 问题 22 ①：16 个板块的「从新页开始」开关默认收起（实测展开态 477px =
                1000px 视口的 47.7%，把「页面概览」「获取分页报告」挤到折叠线以下）。
                收起态只留一行：「分页：N 个板块设了新页」+ 折叠箭头。
                「切到精确预览」不在这里重复一份：画布工具条上的预览口径切换
                （`ResumePreviewToolbar` 的 draft/exact）是它的等价入口，收起后不会丢功能。 */}
            <div className="resume-wb-newpage">
              <button
                type="button"
                className="resume-wb-newpage-toggle"
                aria-expanded={newPageOpen}
                aria-controls={newPageBodyId}
                // 可访问名就是这一行的全部可见文字（摘要），不再另写 aria-label：
                // 摘要里已经带了「分页」与板块数，读屏不需要听第二遍。
                onClick={toggleNewPage}
              >
                <DownOutlined
                  className={`resume-wb-newpage-chevron${newPageOpen ? " is-open" : ""}`}
                />
                <span className="resume-wb-newpage-summary">
                  {newPageBreakCount > 0
                    ? t("workbench.newPage.summary", { count: newPageBreakCount })
                    : t("workbench.newPage.summaryEmpty")}
                </span>
              </button>
              {newPageOpen ? (
                <div className="resume-wb-newpage-body" id={newPageBodyId}>
                  <SectionPaginationPanel
                    document={document}
                    onChange={onDocumentChange}
                    disabled={relayouting}
                    // Q09：预览口径由宿主控制；没接线时按钮不渲染（不留死控件）。
                    previewMode={previewMode}
                    onSwitchToExactPreview={
                      onPreviewModeChange ? () => onPreviewModeChange("exact") : undefined
                    }
                    // Q08：汇总芯片跳到「本份简历结构」页签的对应节点。
                    onJumpToBreak={
                      onSelectPath
                        ? (path) => {
                            changeTab("structure");
                            onSelectPath(path);
                          }
                        : undefined
                    }
                    onNotify={onNotify}
                  />
                </div>
              ) : null}
            </div>
            <PageThumbnailStrip
              loading={pagination.loading}
              hasError={pagination.status === "error"}
            />
          </ResumeParamGroup>
          <ResumeParamGroup title={t("workbench.group.style")} storageKey="style">
            {/* T7c：多个样式面板合并进一个分组后加小标题，用户仍能一眼找到"在哪一块调"。 */}
            <div className="resume-wb-subgroup-title">
              <Typography.Text strong>{t("workbench.group.measure")}</Typography.Text>
            </div>
            <ResumeMeasureControls
              layout={layout}
              baseline={baseline}
              disabled={relayouting}
              catalog={catalog}
              previewRef={previewRef}
              hasPhoto={hasPhoto}
              showMarginSides
              defaultSidesOpen
              onChange={onChange}
            />
            <div className="resume-wb-subgroup-title">
              <Typography.Text strong>{t("workbench.group.spacing")}</Typography.Text>
            </div>
            <ResumeSpacingControls
              layout={layout}
              baseline={baseline}
              catalog={catalog}
              disabled={relayouting}
              previewRef={previewRef}
              onChange={onChange}
            />
            <div className="resume-wb-subgroup-title">
              <Typography.Text strong>{t("workbench.group.appearance")}</Typography.Text>
            </div>
            <ResumeColorControls
              layout={layout}
              baseline={baseline}
              catalog={catalog}
              disabled={relayouting}
              previewRef={previewRef}
              onChange={onChange}
            />
          </ResumeParamGroup>
          {tier !== "three" && editorEnabled ? (
            <span className="resume-wb-narrow-hint">{t("workbench.narrow.editor")}</span>
          ) : null}
        </>
      ) : tab === "structure" ? (
        <div
          ref={structureScrollRef}
          className="resume-wb-v2-panel resume-wb-structure-tab"
          data-panel-scroll="structure"
        >
          <StructurePanel
            document={document}
            onChange={onDocumentChange}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            pickTarget={pickTarget}
            canvasContainer={canvasContainer}
            onNotify={onNotify}
            pagesNeeded={pagesNeeded}
            // #7：条目行右键「排版整条…」→ 本组件的浮层状态（范围整条）。
            onRequestEntryStyle={(path, x, y) => setEntryStyleRequest({ path, x, y })}
            // 只读宿主（无正文的生成预览）：结构树不渲染勾选框，也不能改文档。
            readOnly={!editorEnabled}
            multiSelectedPaths={multiSelectedPaths}
            onMultiSelectedPathsChange={onMultiSelectedPathsChange}
            // Q20：结构树在字段没有值时显示字段目录里的中文标签。
            fieldCatalog={fieldCatalog}
            profileSectionOrder={profileSectionOrder}
            isMaterialOnlyField={(key) => {
              if (!fieldCatalog) return false;
              for (const section of fieldCatalog.sections) {
                const field = section.fields.find((candidate) => candidate.key === key);
                if (field) return field.material_only;
              }
              return false;
            }}
          />
          {/* T7b/U1：条目与字段排版并入结构页签（原独立「条目字段排版」分组已删除），
              结构树选中条目后这里跟随同一 selectedPath。 */}
          <section className="resume-wb-structure-layout" aria-label={t("structure.layout.title")}>
            <Typography.Text strong>{t("structure.layout.title")}</Typography.Text>
            <EntryLayoutPanel
              document={document}
              onChange={onDocumentChange}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              fieldCatalog={fieldCatalog}
              onNotice={onNotify}
              disabled={relayouting}
            />
          </section>
        </div>
      ) : tab === "bilingual" && bilingualPanel ? (
        <div className="resume-wb-v2-panel">{bilingualPanel}</div>
      ) : tab === "assets" && assetsPanel ? (
        <div className="resume-wb-v2-panel">{assetsPanel}</div>
      ) : tab === "sources" && sourcesPanel ? (
        <div className="resume-wb-v2-panel">{sourcesPanel}</div>
      ) : history ? (
        <HistoryPanel {...history} />
      ) : null}
    </div>
  );
}
