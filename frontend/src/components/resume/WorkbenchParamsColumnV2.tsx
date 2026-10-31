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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ReactNode } from "react";
import { Typography } from "antd";
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
import ContactBreaksControl from "../../features/resume-layout/ContactBreaksControl";
import HistoryPanel from "./history/HistoryPanel";
import StructurePanel from "./structure/StructurePanel";
import EntryLayoutPanel from "./EntryLayoutPanel";
import DocumentModePanel from "./DocumentModePanel";
import SectionPaginationPanel from "./pagination/SectionPaginationPanel";
import PageThumbnailStrip from "./pagination/PageThumbnailStrip";
import TypographyToolsPanelV2 from "./typography/TypographyToolsPanelV2";
import { usePaginationReport } from "../../features/resume-pagination/usePaginationReport";
import { usePaginationReportMarkers } from "../../features/resume-pagination/paginationPageMarkers";
import { setPaginationReportRefresh } from "../../features/resume-pagination/paginationRefreshStore";
import type { WorkbenchHistoryTab } from "./useWorkbenchV2History";
import "./workbench-v2.css";

type LeftTab = "params" | "structure" | "bilingual" | "assets" | "sources" | "history";

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
  const buildPaginationRequest = useCallback(
    () => ({
      template: layout.template,
      format_name: layout.format_name,
      page_limit: Number(layout.page_limit) || 1,
      font_scale: layout.font_scale,
      language: layout.language,
      format_config: layout.format_config as Record<string, unknown>,
      content: document,
    }),
    [document, layout],
  );
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
    <div className="resume-wb-col resume-wb-col-params resume-wb-v2-params">
      <WorkbenchLeftTabs<LeftTab>
        ariaLabel={t("workbench.leftTabs.label")}
        value={tab}
        onChange={setTab}
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
            <ContactBreaksControl
              formatConfig={layout.format_config}
              disabled={relayouting}
              onChange={(format_config) => onChange({ ...layout, format_config })}
            />
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
                      setTab("structure");
                      onSelectPath(path);
                    }
                  : undefined
              }
              onNotify={onNotify}
            />
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
            <div className="resume-wb-subgroup-title">
              <Typography.Text strong>{t("structure.typographyTools.title")}</Typography.Text>
            </div>
            <TypographyToolsPanelV2
              document={document}
              layout={layout}
              onLayoutChange={onChange}
              selectedPath={selectedPath}
              multiSelectedPaths={multiSelectedPaths}
              onMultiSelectedPathsChange={onMultiSelectedPathsChange}
              previewRef={previewRef}
              fieldCatalog={fieldCatalog}
              catalog={catalog}
              disabled={relayouting || layoutSaving}
              includeRoleStyles
            />
          </ResumeParamGroup>
          {tier !== "three" && editorEnabled ? (
            <span className="resume-wb-narrow-hint">{t("workbench.narrow.editor")}</span>
          ) : null}
        </>
      ) : tab === "structure" ? (
        <div className="resume-wb-v2-panel resume-wb-structure-tab">
          <StructurePanel
            document={document}
            onChange={onDocumentChange}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            pickTarget={pickTarget}
            canvasContainer={canvasContainer}
            onNotify={onNotify}
            pagesNeeded={pagesNeeded}
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
