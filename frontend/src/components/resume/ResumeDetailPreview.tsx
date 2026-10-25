// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览（B3）：简历中心与「生成简历」预览阶段共用的统一界面——头部元信息、版式控件、
 * 版面诊断卡、预览、底部操作与各自挂载的子弹窗。导出只有一个入口（统一导出面板），
 * 脱敏/水印/页数/字号/行距都在面板里；W19 起制作台「导出」另开「导出交付包」弹层。
 *
 * 只依赖子组件与 `api/resumes`，不 import 两个宿主 Modal，避免循环依赖（设计 §9 ⑨）。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { Collapse, Space, Tag, Tooltip, Typography } from "antd";
import { useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { RESUME_ENHANCEMENT_LEVELS } from "../../config";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../../types";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import { contentSignature } from "../../utils/contentSignature";
import ExportOptionsModal from "../ExportOptionsModal";
import ExportConfigModal from "./delivery/ExportConfigModal";
import { createExportDeliveryApi } from "../../features/resume-delivery";
import { getResume } from "../../api/resumes";
import ResumeZoomModal from "./ResumeZoomModal";
import ResumeEditorModal from "../ResumeEditorModal";
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
import type { RichTextEditAdapter } from "../resume-preview/richText";
import ResumeLayoutDiagnosisCard from "./ResumeLayoutDiagnosisCard";
import ResumeCoverageNotes from "./ResumeCoverageNotes";
import ResumeDetailFooter from "./ResumeDetailFooter";
import EvidencePanel from "./EvidencePanel";
import { useProfileFillSources } from "./useProfileFillSources";
import { useVariants } from "../../features/resume-versions/useVariants";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import type { PathRemap } from "../../features/resume-outline/paths";

interface LayoutStatus {
  pages: number;
  overflow: boolean;
}
interface Props {
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
  liveContent,
  richEdit,
  richDirty,
  onDiscardRichText,
  mergeLive,
  onRemapPaths,
  onDocumentSynced,
  exportFlow = "delivery",
}: Props) {
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<string | null>(null);
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
  const [workbenchDirty, setWorkbenchDirty] = useState(false);
  // 预览口径（草稿 / 精确）住在这一层：主预览与「简历制作台」共用它，任何一处切换，
  // 另一处和制作台都会跟着走（2026-10-21 用户要求）。
  const [previewMode, setPreviewMode] = useState<PreviewMode>("draft");
  const [sharePackageOpen, setSharePackageOpen] = useState(false);
  // 「从我的资料追加一条」的候选：**打开编辑器/制作台时才取一次**（`useProfileFillSources`），
  // 资料接口失败则静默降级成"没有这条入口"，编辑器照常可开。中栏与弹窗共用同一份。
  const { fillSources } = useProfileFillSources(editorOpen || zoomOpen);
  // 内部再包一层引用：父组件可能传 null（尚未量到），子组件需要一份稳定的 ref 传入 ResumePreview。
  const fallbackRef = useRef<ResumePreviewHandle>(null);
  const resolvedPreviewRef = previewRef ?? fallbackRef;
  // 版式目录：**只取一次**，工具栏两行的两组控件共用（见 `useResumeTemplateCatalog`）。
  const { catalog } = useResumeTemplateCatalog();
  const variantsState = useVariants({ resumeId: detail.id }); // W16 导出变体选择器数据源
  // 缺省跟随 onResumeRevised：能刷新预览就有意义，不能刷新就不该摆出这个入口。
  const showRevise = showReviseAction ?? Boolean(onResumeRevised);
  const enhancementLabel = RESUME_ENHANCEMENT_LEVELS.find(
    (item) => item.value === detail.enhancement_level,
  )?.label;
  // 风险扫描的"内容签名"：只随 content 变化重算，用来判断"扫描之后正文是不是改过了"。
  const riskContentSignature = useMemo(() => contentSignature(detail.content), [detail.content]);
  /** 警告分级（#3）：疑似虚构与岗位未选上性质不同；新记录用 coverage_notes，旧记录按特征句拆。 */
  const { fabricationWarnings, legacyCoverageWarnings } = useMemo(() => {
    const legacy = detail.warnings.filter((warning) => warning.includes("没有出现在这份简历里"));
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
  const openAtPath = (path: string) => {
    setEditorTarget(path);
    setEditorOpen(true);
  };
  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Tag color={detail.source === "manual" ? "purple" : "blue"}>
          {detail.source === "manual" ? "用户编写" : "AI 生成"}
        </Tag>
        {detail.job_id ? (
          <Tag color="blue">目标岗位：{detail.job_title || "-"}</Tag>
        ) : (
          // 通用简历没有岗位；job_title 里存的是求职意向。
          <>
            <Tooltip title="不关联岗位、可投递多个方向的简历">
              <Tag color="purple">通用简历</Tag>
            </Tooltip>
            <Tag>求职意向：{detail.job_title || "未填写"}</Tag>
          </>
        )}
        {detail.company && <Tag>{detail.company}</Tag>}
        <Tag>模型：{detail.model || "-"}</Tag>
        <Tag color={detail.enhancement_enabled ? "green" : undefined}>
          美化拓展：{detail.enhancement_enabled ? (enhancementLabel ?? "已开启") : "未开启"}
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          创建于 {detail.created_at.replace("T", " ").slice(0, 16)}
        </Typography.Text>
      </Space>
      {/* 生成说明（折叠）：回答"为什么是这样一份简历"。 */}
      {detail.rationale ? (
        <Collapse
          size="small"
          items={[
            {
              key: "rationale",
              label: "为什么是这样一份简历（生成说明）",
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
        content={liveContent ?? detail.content}
        onApplyContent={onSaveEditedResume}
      />
      {/* 「没写进这份简历」的中性分组（#3/#5）：与"疑似虚构"分开；细节在 ResumeCoverageNotes。 */}
      <ResumeCoverageNotes
        notes={coverageNotes}
        legacyWarnings={legacyCoverageWarnings}
        onRevise={(instructions) => {
          setReviseInstructions(instructions);
          setReviseOpen(true);
        }}
        onOpenEditor={() => {
          setEditorTarget(null);
          setEditorOpen(true);
        }}
      />
      {/* 事实来源展示（RF-13）：回答"写进去的内容从哪来"，挂在 coverage Alert 之后、预览之前。 */}
      {factAnnotations.length > 0 && (
        <EvidencePanel annotations={factAnnotations} content={detail.content} />
      )}
      <ResumePreview
        ref={resolvedPreviewRef}
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
              hasPhoto={Boolean(detail.content?.photo)}
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
              <Typography.Text type="secondary">正在按新设置重新排版…</Typography.Text>
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
        onPickField={openAtPath}
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
        editorBlocked={workbenchDirty}
        onOpenEditor={() => {
          setEditorTarget(null);
          setEditorOpen(true);
        }}
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

      <ResumeEditorModal
        open={editorOpen}
        content={detail.content}
        initialTarget={editorTarget}
        // `resumeId` 决定编辑器的草稿作用域（`resume.edit#<id>`）；写作增强搬到右键之后
        // 不再由它挂页签，但"这份草稿属于哪份简历"仍然只能靠它区分。
        resumeId={detail.id}
        onClose={() => {
          setEditorOpen(false);
          setEditorTarget(null);
        }}
        // 「从我的资料追加一条」：编辑**已有**简历也要这条入口（新建简历那边一直有）。
        // 只给候选项，不给 `fillAll`——那是"从空白开始"的捷径，编辑已有简历时会把整份
        // 内容替换掉；`entryFill` 用缺省 true（条目级填进本条同样需要）。
        fillSources={fillSources}
        onSave={onSaveEditedResume}
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
          content={liveContent ?? detail.content ?? null}
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
      <ResumeZoomModal
        open={zoomOpen}
        html={html}
        warnings={detail.warnings}
        pages={layout.page_limit}
        layout={layout}
        resumeId={detail.id}
        relayouting={relayouting}
        hasPhoto={Boolean(detail.content?.photo)}
        documentMode={detail.document_mode}
        pagesNeeded={layoutStatus?.pages ?? null}
        onApplyLayout={onApplyLayout}
        onCommitLayout={onCommitLayout}
        layoutSaving={layoutSaving}
        // 草稿靠这两个把「保存」常驻（刚建出来的草稿内容与版式都没动过，0051）。
        isDraft={Boolean(detail.draft)}
        onPublishDraft={onPublishDraft}
        documentPipeline={documentPipeline}
        resumeTitle={detail.title}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        exactPreview={exactPreview}
        // 中栏编辑与保存都走宿主已有的那份（PATCH + setDetail + 重渲染）。
        content={detail.content}
        // 右栏实时预览要按"加上还没保存的粗体"那一版重排。
        liveContent={liveContent}
        mergeLive={mergeLive}
        onRemapPaths={onRemapPaths}
        onDocumentSynced={onDocumentSynced}
        richDirty={richDirty}
        onDiscardRichText={onDiscardRichText}
        onSaveContent={onSaveEditedResume}
        // 加粗也算中栏的改动：并进上报值，宿主才会禁用「手动调整」（两个编辑器各持一份内容）。
        onEditorDirtyChange={(next) => setWorkbenchDirty(next || Boolean(richDirty))}
        richEdit={richEdit}
        // 中栏与「手动调整」共用同一份候选（只给一处开，用户就得关掉制作台才能从资料带一条进来）。
        fillSources={fillSources}
        onClose={() => {
          setZoomOpen(false);
          // 制作台关掉后中栏已经销毁，它的脏值不再有出口——不清掉会永久禁用「手动调整」。
          setWorkbenchDirty(false);
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
