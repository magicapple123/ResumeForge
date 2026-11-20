// SPDX-License-Identifier: Apache-2.0
/**
 * Left-column「排版参数」tab of the v2 workbench: template / page / style groups.
 * Split out of `./WorkbenchParamsColumnV2.tsx` to keep both files under the line
 * budget; pure move, no behaviour change.
 */
import { DownOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import { useCallback, useId, useMemo, useState } from "react";
import type { RefObject } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import HintDetail from "../../../components/common/HintDetail";
import type { ResumeDetail, ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { PreviewMode } from "../preview/config";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import ResumeParamGroup from "../layout/ResumeParamGroup";
import ResumeTemplateControls from "../layout/ResumeTemplateControls";
import ResumeMeasureControls from "../layout/ResumeMeasureControls";
import ResumeSpacingControls from "../layout/ResumeSpacingControls";
import ResumeColorControls from "../layout/ResumeColorControls";
import RoleStylePanel from "../layout/RoleStylePanel";
import ResumeLanguageSelect from "../layout/ResumeLanguageSelect";
import ContactBreaksControl from "../layout/ContactBreaksControl";
import SkillColumnsControl from "../layout/SkillColumnsControl";
import DocumentModePanel from "../research/DocumentModePanel";
import SectionPaginationPanel from "../pagination/SectionPaginationPanel";
import PageThumbnailStrip from "../pagination/PageThumbnailStrip";
import WorkbenchLayoutStatusBar from "./WorkbenchLayoutStatusBar";
import WorkbenchRationaleEntry from "./WorkbenchRationaleEntry";
import PhotoTab from "./PhotoTab";
import { pageLimitOptions } from "../research/documentMode";

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

export interface WorkbenchParamsTabProps {
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
  onNotify?: (message: string) => void;
  pagesNeeded?: number | null;
  resumeId?: number | null;
  revision?: number | null;
  documentMode?: "resume" | "long_cv";
  onDocumentModeSaved?: (detail: ResumeDetail) => void;
  layoutSaving?: boolean;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  dirty?: boolean;
  rationale?: string | null;
  paginationLoading: boolean;
  paginationHasError: boolean;
  /** Jump from the pagination chip to the structure tab (undefined when unsupported). */
  onJumpToStructure?: (path: string) => void;
}

export default function WorkbenchParamsTab({
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
  onNotify,
  pagesNeeded,
  resumeId,
  revision,
  documentMode,
  onDocumentModeSaved,
  layoutSaving = false,
  previewMode,
  onPreviewModeChange,
  dirty,
  rationale = null,
  paginationLoading,
  paginationHasError,
  onJumpToStructure,
}: WorkbenchParamsTabProps) {
  useLocale();
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

  return (
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
        {/* #24 24A：常驻版面状态条（占用率 / 需要几页 / 超出几页）。它必须在**滑块
                上方**：拖动「行距」「字号」时眼睛盯的是同一行数字在变，藏在组底部就回到
                "盲改"了。数字只本地算（`layoutStatusSummary`），点开弹层才问后端。 */}
        <WorkbenchLayoutStatusBar
          layout={layout}
          baseline={baseline}
          resumeId={resumeId}
          // 版本号前进了而版式没变 = 刚存过，`未保存` 随之消失（判据见组件内的钩子）。
          revision={revision ?? null}
          previewRef={previewRef}
          relayouting={relayouting}
          dirty={dirty}
          onApplyLayout={onChange}
        />
        {/* #24 24F：「查看生成说明」入口（正文用现有的 `RationaleParagraphs`）。
                紧挨状态条：两块回答的是同一类问题——眼前这一版是怎么来的、它占了几页。
                没有 rationale 时组件自己整块不渲染，不留死链。 */}
        <WorkbenchRationaleEntry rationale={rationale} />
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
          {/* I-17：40 字的"只改小节标题、不翻译正文"原本是包住整个下拉的 tooltip——
              悬停才看得见，且会盖住主操作。现在它是下拉右侧的 `ⓘ`。
              I-06：包装层不再写内联 `justifySelf` / `inline-flex`（内联优先级最高，会让
              "控件铺满控件列"整条 CSS 白改）；`.resume-wb-field-control` 负责
              「控件吃满第一格、ⓘ 固定第二格」。 */}
          <span className="resume-wb-field-control">
            <ResumeLanguageSelect
              value={layout.language ?? "zh-CN"}
              disabled={relayouting || undefined}
              onChange={(language) => onChange({ ...layout, language })}
            />
            <HintDetail detail={t("resume.language.hint")} label={t("resume.language.hintAria")} />
          </span>
        </div>
        <ContactBreaksControl
          formatConfig={layout.format_config}
          disabled={relayouting}
          onChange={(format_config) => onChange({ ...layout, format_config })}
        />
        <SkillColumnsControl
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
            <DownOutlined className={`resume-wb-newpage-chevron${newPageOpen ? " is-open" : ""}`} />
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
                onJumpToBreak={onJumpToStructure}
                onNotify={onNotify}
              />
            </div>
          ) : null}
        </div>
        <PageThumbnailStrip loading={paginationLoading} hasError={paginationHasError} />
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
        <RoleStylePanel
          layout={layout}
          catalog={catalog}
          previewRef={previewRef}
          disabled={relayouting || undefined}
          visibleRoles={["field_label"]}
          compact
          onChange={onChange}
        />
      </ResumeParamGroup>
      {/* 5.1：照片（原独立页签）并入这里，作为**第四个**分组。
              放在最后的理由：前三组是「模板 → 版面 → 样式（字号/间距/外观）」的阅读顺序，
              照片是页眉里的一块独立几何，插在中间会打断这条线。
              仍然**常驻**：没有照片的人正是要进来上传的那一类。 */}
      <ResumeParamGroup title={t("workbench.group.photo")} storageKey="photo">
        <PhotoTab
          document={document}
          layout={layout}
          disabled={relayouting || !editorEnabled}
          onDocumentChange={onDocumentChange}
          onLayoutChange={onChange}
          onNotice={onNotify}
        />
      </ResumeParamGroup>
      {tier !== "three" && editorEnabled ? (
        <span className="resume-wb-narrow-hint">{t("workbench.narrow.editor")}</span>
      ) : null}
    </>
  );
}
