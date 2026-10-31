// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览（B3）：简历中心与「生成简历」预览阶段共用的统一界面——头部元信息、版式控件、
 * 版面诊断卡、预览、底部操作与各自挂载的子弹窗。导出只有一个入口（统一导出面板），
 * 脱敏/水印/页数/字号/行距都在面板里；W19 起制作台「导出」另开「导出交付包」弹层。
 *
 * 只依赖子组件与 `api/resumes`，不 import 两个宿主 Modal，避免循环依赖（设计 §9 ⑨）。
 */
import type { Props } from "./ResumeDetailPreview.types";
import { Collapse, Space, Tag, Tooltip, Typography } from "antd";
import { useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useNavigate } from "react-router-dom";
import { RESUME_ENHANCEMENT_LEVELS } from "../../config";
import { contentSignature } from "../../utils/contentSignature";
import ExportOptionsModal from "../ExportOptionsModal";
import ExportConfigModal from "./delivery/ExportConfigModal";
import { createExportDeliveryApi } from "../../features/resume-delivery";
import { getResume } from "../../api/resumes";
import ResumeWorkbenchV2 from "./ResumeWorkbenchV2";
import { useResumeTemplateCatalog } from "../../hooks/useResumeTemplateCatalog";
import ResumeMeasureControls from "./ResumeMeasureControls";
import ResumeTemplateControls from "./ResumeTemplateControls";
import { useShortcut } from "../../features/shortcuts/useShortcutKeymap";
import ResumeQualityModal from "../ResumeQualityModal";
import ResumeSuggestionsModal from "../ResumeSuggestionsModal";
import ResumeReviseModal from "./ResumeReviseModal";
import SharePackageModal from "../SharePackageModal";
import ResumePreview, {
  type ExactPreviewOptions,
  type ResumePreviewHandle,
} from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import { buildExactPreviewOptions } from "../resume-preview/exactPreviewOptions";
import ResumeLayoutDiagnosisCard from "./ResumeLayoutDiagnosisCard";
import ResumeCoverageNotes from "./ResumeCoverageNotes";
import ResumeDetailFooter from "./ResumeDetailFooter";
import EvidencePanel from "./EvidencePanel";
import { documentHasPhoto } from "../../features/resume-document/view";
import { useFieldPlacementCatalog } from "../../features/profile-library/fieldPlacement";
import { useVariants } from "../../features/resume-versions/useVariants";
/** W19 导出交付包：模块级单例（与 DeliveryArchiveModal 同一注入模式，测试可替换）。 */
const deliveryApi = createExportDeliveryApi();
export default function ResumeDetailPreview({
  detail,
  html,
  layout,
  layoutStatus,
  measure,
  pdfDirectAvailable,
  relayouting,
  previewRef,
  onLayoutStatus,
  onMeasure,
  onApplyLayout,
  onCommitLayout,
  layoutSaving = false,
  onPublishDraft,
  documentPipeline,
  onApplyFittedFormat,
  onSaveEditedResume,
  autoOpenWorkbench = false,
  suggestionsGenerated,
  suggestionsResetKey,
  onSuggestionsGenerated,
  onResumeRevised,
  showReviseAction,
  extraActions,
  exportFlow = "delivery",
  onDocumentSynced,
  onReplaceDocument,
}: Props) {
  useLocale();
  const navigate = useNavigate();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseInstructions, setReviseInstructions] = useState("");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  // W19：制作台动作条的「导出」打开「导出交付包」弹层（旧面板仍留给主预览入口）。
  const [deliveryExportOpen, setDeliveryExportOpen] = useState(false);
  // 导出入口按内容是否已定稿分流：已保存 → 交付包；生成/未保存预览 → 旧导出选项。
  const openExportByFlow = () => {
    if (exportFlow === "legacy") setExportOptionsOpen(true);
    else setDeliveryExportOpen(true);
  };
  // R8：预览打开时按 Ctrl/⌘+Shift+E 直接拉起导出面板——导出是这一步最常做的事。
  useShortcut("exportPdf", (event) => {
    event.preventDefault();
    setExportOptionsOpen(true);
  });
  const [zoomOpen, setZoomOpen] = useState(autoOpenWorkbench);
  // 制作台中栏有没有未保存的内容：有值时禁用底部「手动调整」（两个编辑器同时开会互相覆盖草稿）。
  // 预览口径（草稿 / 精确）住在这一层：主预览与「简历制作台」共用它，任何一处切换，
  // 另一处和制作台都会跟着走（2026-10-21 用户要求）。
  const [previewMode, setPreviewMode] = useState<PreviewMode>("draft");
  const [sharePackageOpen, setSharePackageOpen] = useState(false);
  /**
   * v2 文档 → v1 只读投影（唯一一处转换）：版面诊断卡、事实来源面板与导出核对还按 v1 形状
   * 读内容，它们不渲染纸面、也不写库；等这些组件迁到 v2 后本投影随之删除。
   */
  // 内部再包一层引用：父组件可能传 null（尚未量到），子组件需要一份稳定的 ref 传入 ResumePreview。
  const fallbackRef = useRef<ResumePreviewHandle>(null);
  const resolvedPreviewRef = previewRef ?? fallbackRef;
  // 版式目录：**只取一次**，工具栏两行的两组控件共用（见 `useResumeTemplateCatalog`）。
  const { catalog } = useResumeTemplateCatalog();
  // 资料字段目录（纸面位置 / 仅素材）：制作台的「仅素材」徽标与添加字段菜单都读它。
  // 会话级缓存；接口失败时保持 null，编辑器退回内置 fallback（不阻塞编辑）。
  const { catalog: fieldCatalog } = useFieldPlacementCatalog();
  const variantsState = useVariants({ resumeId: detail.id }); // W16 导出变体选择器数据源
  // 缺省跟随 onResumeRevised：能刷新预览就有意义，不能刷新就不该摆出这个入口。
  const showRevise = showReviseAction ?? Boolean(onResumeRevised);
  const enhancementLabelKey = RESUME_ENHANCEMENT_LEVELS.find(
    (item) => item.value === detail.enhancement_level,
  )?.labelKey;
  /** 美化拓展那一格的取值：没开启就写「未开启」，开了但没记录档位就只写「已开启」。 */
  const enhancementLevelText = !detail.enhancement_enabled
    ? t("resumes.list.off")
    : enhancementLabelKey
      ? t(enhancementLabelKey)
      : t("resumes.list.on");
  // 风险扫描的"内容签名"：只随 content 变化重算，用来判断"扫描之后正文是不是改过了"。
  const riskContentSignature = useMemo(() => contentSignature(detail.content), [detail.content]);
  /** 警告分级（#3）：疑似虚构与岗位未选上性质不同；新记录用 coverage_notes，旧记录按特征句拆。 */
  const { fabricationWarnings, legacyCoverageWarnings } = useMemo(() => {
    // i18n-ok: 后端警告原文，按特征句区分新旧覆盖说明（协议值，不翻）
    const legacy = detail.warnings.filter((warning) => warning.includes("没有出现在这份简历里"));
    // i18n-ok: 同上
    const rest = detail.warnings.filter((warning) => !warning.includes("没有出现在这份简历里"));
    return { fabricationWarnings: rest, legacyCoverageWarnings: legacy };
  }, [detail.warnings]);
  const coverageNotes = detail.coverage_notes ?? [];
  // 精确预览上下文只在这里构造一次：主预览与制作台必须拿到同一份（各拼一份必然漂）。
  // `catalog` 一并传进去：衬线标题的说明（P1-2）只需要目录里那一个布尔值，目录本身已经取过了。
  const exactPreview = useMemo<ExactPreviewOptions>(
    () => buildExactPreviewOptions(detail, layout, riskContentSignature, catalog),
    [catalog, detail, layout, riskContentSignature],
  );
  // 事实来源标注（RF-13）：证据面板用它列出"这条内容从哪来"；预览上的悬停角标随编辑模式一起去掉了（2026-10-21），标注数据本身仍然有效。
  const factAnnotations = useMemo(() => detail.fact_annotations ?? [], [detail.fact_annotations]);
  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Tag color={detail.source === "manual" ? "purple" : "blue"}>
          {detail.source === "manual" ? t("resumes.list.sourceManual") : t("resumes.list.sourceAi")}
        </Tag>
        {detail.job_id ? (
          <Tag color="blue">
            {t("appConfig.detail.targetJob", { job: detail.job_title || "-" })}
          </Tag>
        ) : (
          // 通用简历没有岗位；job_title 里存的是求职意向。
          <>
            <Tooltip title={t("resumes.list.generalHint")}>
              <Tag color="purple">{t("resumes.list.general")}</Tag>
            </Tooltip>
            <Tag>
              {t("resumes.list.intent", {
                job: detail.job_title || t("appConfig.detail.notFilled"),
              })}
            </Tag>
          </>
        )}
        {detail.company && <Tag>{detail.company}</Tag>}
        <Tag>{t("appConfig.detail.model", { model: detail.model || "-" })}</Tag>
        <Tag color={detail.enhancement_enabled ? "green" : undefined}>
          {t("appConfig.detail.enhancement", { level: enhancementLevelText })}
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {t("appConfig.detail.createdAt", {
            time: detail.created_at.replace("T", " ").slice(0, 16),
          })}
        </Typography.Text>
      </Space>
      {/* 生成说明（折叠）：回答"为什么是这样一份简历"。 */}
      {detail.rationale ? (
        <Collapse
          size="small"
          items={[
            {
              key: "rationale",
              label: t("appConfig.detail.rationale"),
              children: (
                <Typography.Paragraph
                  style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13 }}
                  type="secondary"
                >
                  {detail.rationale}
                </Typography.Paragraph>
              ),
            },
          ]}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {/* W09：诊断卡在制作台弹层背后，正文取这一页看到的版本；应用走宿主写入链路。 */}
      <ResumeLayoutDiagnosisCard
        resumeId={detail.id}
        measure={measure}
        overflow={layoutStatus?.overflow ?? false}
        previewRef={resolvedPreviewRef}
        layout={layout}
        disabled={relayouting}
        onApplied={(formatConfig) => onApplyFittedFormat(formatConfig)}
        onAddPage={() => onApplyLayout({ ...layout, page_limit: layout.page_limit + 1 })}
        // v2 下「按诊断建议改正文」的入口先关掉：它写回的是 v1 分区结构，会把 v2 文档
        // 打回旧模型。等版面优化器迁到 v2 item 后再接回来。
      />
      {/* 「没写进这份简历」的中性分组（#3/#5）：与"疑似虚构"分开；细节在 ResumeCoverageNotes。 */}
      <ResumeCoverageNotes
        notes={coverageNotes}
        legacyWarnings={legacyCoverageWarnings}
        onRevise={(instructions) => {
          setReviseInstructions(instructions);
          setReviseOpen(true);
        }}
        // 预览里不再提供手动编辑：这条提示指向「简历制作台」，详细编辑都在那边做。
        onOpenEditor={() => setZoomOpen(true)}
      />
      {/* 事实来源展示（RF-13）：回答"写进去的内容从哪来"，挂在 coverage Alert 之后、预览之前。 */}
      {factAnnotations.length > 0 && (
        <EvidencePanel annotations={factAnnotations} content={detail.content as never} />
      )}
      <ResumePreview
        ref={resolvedPreviewRef}
        // 2026-10-28：预览里不再提供「草稿模式编辑」，详细编辑去制作台。
        showClickToEdit={false}
        // 具名插槽（P2/D4）：结构类第一行、度量类第二行；目录本组件取一次两组共用。
        // 渲染中不禁用（D12）：禁用会让用户以为坏了；边距合并保证最后一次生效。
        templateControls={
          // 与「岗位详情 → AI 生成」同一套控件（非 compact）：分组/尺寸/排布必须一致。
          <ResumeTemplateControls
            layout={layout}
            catalog={catalog}
            onChange={(next) => onApplyLayout(next)}
          />
        }
        measureControls={
          <>
            <ResumeMeasureControls
              layout={layout}
              catalog={catalog}
              previewRef={resolvedPreviewRef}
              // 没有照片时照片滑杆禁用并说明原因：photo_scale 在没有照片时完全惰性，
              // 让用户拖一个"什么都没发生"的滑杆是最差的反馈。
              hasPhoto={documentHasPhoto(detail.content)}
              // 显式写 false：分边页边距只在「简历制作台」里出现（那一栏有纵向空间），
              // 主预览的工具栏是两行紧凑形态，多一行折叠标题会把它顶宽。
              showMarginSides={false}
              // 照片大小滑杆只留在简历制作台：主预览这一栏只放"改一下就能在纸面上看出
              // 差别"的高频项（2026-10-23 用户口径："预览界面只展示部分功能"）。
              showPhotoScale={false}
              onChange={(next) => onApplyLayout(next)}
            />
            {/* 「正在按新设置重新排版…」留在度量这一行：它说明的是"你刚拖的那个值正在生效"，
                回到第一行会与"改版式"的按钮混在一起。 */}
            {relayouting ? (
              <Typography.Text type="secondary">
                {t("appConfig.detail.relayouting")}
              </Typography.Text>
            ) : null}
          </>
        }
        html={html}
        pages={layout.page_limit}
        // 精确预览（方案 A）：拿得到记录 id 就能用真实导出 PDF 渲染。
        // 草稿值（页数/字号/版式）一并传进去——"拖完滑块还没保存"的版式正是最需要
        // 在导出里核对的东西，只传记录值就等于让它看不见。
        exactPreview={exactPreview}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        // 点纸面字段 → 打开「手动调整」并定位；右键加粗只在制作台提供（主预览没有保存入口）。
        warnings={fabricationWarnings}
        onLayoutStatus={onLayoutStatus}
        onMeasure={onMeasure}
      />
      {/* 固定在弹窗底部：内容长（版面诊断 + 预览）时不必一路翻到最后才够得着这些按钮。 */}
      <ResumeDetailFooter
        resumeId={detail.id}
        layout={layout}
        pdfDirectAvailable={pdfDirectAvailable}
        extraActions={extraActions}
        showRevise={showRevise}
        suggestionsGenerated={suggestionsGenerated}
        jobId={detail.job_id ?? null}
        onOpenZoom={() => setZoomOpen(true)}
        onOpenRevise={() => setReviseOpen(true)}
        onOpenSuggestions={() => setSuggestionsOpen(true)}
        // 没岗位时按钮本身已禁用；守卫留在跳转这一侧，避免将来有第二个入口时忘了判空。
        onOpenJob={() => {
          if (detail.job_id) navigate(`/jobs?job_id=${detail.job_id}`);
        }}
        onOpenAssistant={() => navigate(`/assistant?resume_id=${detail.id}&new=1`)}
        onOpenQuality={() => setQualityOpen(true)}
        onOpenSharePackage={() => setSharePackageOpen(true)}
        onOpenExportOptions={openExportByFlow}
      />

      <ResumeSuggestionsModal
        open={suggestionsOpen}
        recordId={detail.id}
        resetKey={suggestionsResetKey}
        onClose={() => setSuggestionsOpen(false)}
        onGenerated={onSuggestionsGenerated}
        onApplied={(detail) => onResumeRevised?.(detail)}
      />
      {/* 修订弹窗只看 onResumeRevised：生成预览虽藏底部按钮，但「AI 补上这段」仍要能弹出。 */}
      {onResumeRevised ? (
        <ResumeReviseModal
          open={reviseOpen}
          recordId={detail.id}
          initialInstructions={reviseInstructions}
          onClose={() => setReviseOpen(false)}
          onApplied={(detail) => onResumeRevised?.(detail)}
        />
      ) : null}
      <ResumeQualityModal
        open={qualityOpen}
        resumeId={detail.id}
        contentSignature={riskContentSignature}
        jobId={detail.job_id ?? undefined}
        onClose={() => setQualityOpen(false)}
      />
      {exportFlow === "delivery" ? (
        <ExportConfigModal
          open={deliveryExportOpen}
          onClose={() => setDeliveryExportOpen(false)}
          api={deliveryApi}
          resumeId={detail.id}
          content={detail.content}
          revision={documentPipeline?.revision ?? null}
          resumeTitle={detail.title}
          company={detail.company}
          jobTitle={detail.job_title}
          template={layout.template}
          formatName={layout.format_name}
          language={layout.language}
          documentMode={detail.document_mode}
          variants={variantsState.variants}
          variantLoading={variantsState.loading}
          // 未保存的草稿版式也进同快照（不传则后端用记录里那份）。
          pageLimit={layout.page_limit}
          fontScale={layout.font_scale}
          formatConfig={layout.format_config}
          onReloadRevision={async () => (await getResume(detail.id)).revision ?? null}
        />
      ) : null}
      {exportFlow === "legacy" ? (
        <ExportOptionsModal
          recordId={detail.id}
          open={exportOptionsOpen}
          initialPageLimit={layout.page_limit}
          initialFontScale={layout.font_scale}
          initialFormatConfig={layout.format_config}
          initialLanguage={layout.language ?? "zh-CN"}
          pdfDirectAvailable={pdfDirectAvailable}
          onClose={() => setExportOptionsOpen(false)}
        />
      ) : null}
      <ResumeWorkbenchV2
        open={zoomOpen}
        html={html}
        warnings={detail.warnings}
        pages={layout.page_limit}
        layout={layout}
        resumeId={detail.id}
        resumeTitle={detail.title}
        resumeLanguage={detail.language}
        relayouting={relayouting}
        hasPhoto={documentHasPhoto(detail.content)}
        pagesNeeded={layoutStatus?.pages ?? null}
        onApplyLayout={onApplyLayout}
        onCommitLayout={onCommitLayout}
        layoutSaving={layoutSaving}
        // 草稿靠这两个把「保存」常驻（刚建出来的草稿内容与版式都没动过，0051）。
        isDraft={Boolean(detail.draft)}
        onPublishDraft={onPublishDraft}
        documentPipeline={documentPipeline}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        exactPreview={exactPreview}
        // v2 文档就是中栏编辑与保存的唯一内容；转换摘要在第一次读旧简历时显示。
        document={detail.content}
        fieldCatalog={fieldCatalog}
        documentMode={detail.document_mode}
        onDocumentModeSaved={onDocumentSynced}
        onAdoptDocument={onReplaceDocument}
        onSaveContent={onSaveEditedResume}
        conversion={detail.document_conversion ?? null}
        contextSnapshot={detail.context_snapshot ?? null}
        onClose={() => {
          setZoomOpen(false);
        }}
        onExport={openExportByFlow}
      />
      <SharePackageModal
        recordId={detail.id}
        open={sharePackageOpen}
        onClose={() => setSharePackageOpen(false)}
      />
    </div>
  );
}
