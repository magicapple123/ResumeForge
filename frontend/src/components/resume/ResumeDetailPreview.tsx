// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览（B3）：简历中心与「生成简历」预览阶段共用的统一界面。
 *
 * 此前同一套预览有两份实现（`ResumeDetailModal` 的完整预览、`GenerateResumeModal` 的
 * preview 阶段各写一遍），按钮、诊断卡与导出项都各自维护，改一处漏一处。现在把它们
 * 收进这一个组件：头部元信息 Tags + 版式控件（compact）+ 版面诊断卡 + 简历预览 + 底部
 * 完整操作（手动调整 / 岗位建议 / 查看岗位 / 咨询助手 / 质量检测 / 离线分享）+ 导出按钮，
 * 以及这些操作各自挂载的子弹窗。导出只有一个入口（`ExportButtons` → 统一导出面板）：
 * 脱敏、水印、页数、字号、行距都在面板里，不再各占一个按钮。
 *
 * 只依赖子组件与 `api/resumes`，**不** import `ResumeDetailModal` / `GenerateResumeModal`，
 * 避免循环依赖（设计 §9 ⑨）。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { Button, Collapse, Space, Tag, Tooltip, Typography } from "antd";
import { Alert } from "antd";
import { useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { RESUME_ENHANCEMENT_LEVELS } from "../../config";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../../types";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import { contentSignature } from "../../utils/contentSignature";
import ExportOptionsModal from "../ExportOptionsModal";
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
import ResumeLayoutDiagnosisCard from "./ResumeLayoutDiagnosisCard";
import ResumeDetailFooter from "./ResumeDetailFooter";
import EvidencePanel from "./EvidencePanel";

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
  /** 「自动一页」试出方案并保存后的重渲染（只重渲染，不再写回版式）。 */
  onApplyFittedFormat: (formatConfig: ResumeFormatConfig) => void;
  onSaveEditedResume: (content: ResumeContent) => Promise<void>;
  /** 是否已经生成过岗位优化建议：决定按钮文案是「生成」还是「查看」。 */
  suggestionsGenerated: boolean;
  suggestionsResetKey: number;
  onSuggestionsGenerated: () => void;
  /**
   * 修订（AI 修改 / 采纳建议）成功后刷新预览的回调：父组件负责 setDetail + 重渲染。
   * 建议「采纳并修改」依赖它刷新预览，两个宿主都应该传；「AI 修改 / 重新生成」
   * 按钮的显隐由 ``showReviseAction`` 单独控制——生成弹窗预览阶段已有自己的
   * 「重新生成」向导，再显示一个同名入口只会让人困惑。
   */
  onResumeRevised?: (detail: ResumeDetail) => Promise<void> | void;
  /** 是否显示「AI 修改 / 重新生成」按钮；缺省跟随 ``onResumeRevised`` 是否传入。 */
  showReviseAction?: boolean;
  /** 额外操作（如生成弹窗里的「重新生成 / 去简历中心 / 完成」）插在底部按钮区。 */
  extraActions?: ReactNode;
}

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
  onApplyFittedFormat,
  onSaveEditedResume,
  suggestionsGenerated,
  suggestionsResetKey,
  onSuggestionsGenerated,
  onResumeRevised,
  showReviseAction,
  extraActions,
}: Props) {
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseInstructions, setReviseInstructions] = useState("");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  // R8：预览打开时按 Ctrl/⌘+Shift+E 直接拉起导出面板——导出是这一步最常做的事。
  useShortcut("exportPdf", (event) => {
    event.preventDefault();
    setExportOptionsOpen(true);
  });
  const [zoomOpen, setZoomOpen] = useState(false);
  // 预览口径（草稿 / 精确）住在这一层：主预览与「查看大图」共用它，任何一处切换，
  // 另一处和大图都会跟着走（2026-10-21 用户要求）。
  const [previewMode, setPreviewMode] = useState<PreviewMode>("draft");
  const [sharePackageOpen, setSharePackageOpen] = useState(false);
  // 内部再包一层引用：父组件可能传 null（尚未量到），子组件需要一份稳定的 ref 传入 ResumePreview。
  const fallbackRef = useRef<ResumePreviewHandle>(null);
  const resolvedPreviewRef = previewRef ?? fallbackRef;
  // 版式目录：**只取一次**，工具栏两行的两组控件共用（见 `useResumeTemplateCatalog`）。
  const { catalog } = useResumeTemplateCatalog();
  // 缺省跟随 onResumeRevised：能刷新预览就有意义，不能刷新就不该摆出这个入口。
  const showRevise = showReviseAction ?? Boolean(onResumeRevised);

  const enhancementLabel = RESUME_ENHANCEMENT_LEVELS.find(
    (item) => item.value === detail.enhancement_level,
  )?.label;

  // 风险扫描的"内容签名"：只随 content 变化重算，用来判断"扫描之后正文是不是改过了"。
  const riskContentSignature = useMemo(() => contentSignature(detail.content), [detail.content]);

  /**
   * 警告分级（#3）：「疑似虚构」与「岗位筛选没选上」性质完全不同，不该共用一面
   * 红墙。新生成的记录直接用结构化 coverage_notes；旧记录的未收录警告混在
   * warnings 文本里，按特征句拆出来（那句措辞由 resume_coverage 写死，稳定）。
   */
  const { fabricationWarnings, legacyCoverageWarnings } = useMemo(() => {
    const legacy = detail.warnings.filter((warning) => warning.includes("没有出现在这份简历里"));
    const rest = detail.warnings.filter((warning) => !warning.includes("没有出现在这份简历里"));
    return { fabricationWarnings: rest, legacyCoverageWarnings: legacy };
  }, [detail.warnings]);
  const coverageNotes = detail.coverage_notes ?? [];
  // 主预览与「查看大图」必须拿到**同一份**精确预览上下文：各自拼一份迟早会漂
  // （一处带草稿页数、一处带记录页数，用户就会看到"大图少一页"）。
  const exactPreview = useMemo<ExactPreviewOptions>(
    () => ({
      resumeId: detail.id,
      // 模板与版式也走草稿值：换完还没点保存，精确预览就得按新的排。
      template: layout.template,
      formatName: layout.format_name,
      fontScale: layout.font_scale,
      // 语言也得走草稿值：选了 English 还没保存，精确预览就必须按英文排——
      // 这是"草稿选英文、精确预览还是中文"的唯一修复点。
      language: layout.language ?? "zh-CN",
      formatConfig: layout.format_config as unknown as Record<string, unknown>,
      // 正文签名：改了内容也要重排一次（版式字段已各自进依赖）。
      // `riskContentSignature` 已经为风险扫描算过，直接复用（同一份 content）。
      contentSignature: riskContentSignature,
    }),
    [
      detail.id,
      layout.template,
      layout.format_name,
      layout.font_scale,
      layout.language,
      layout.format_config,
      riskContentSignature,
    ],
  );
  // 事实来源标注（RF-13）：证据面板用它列出"这条内容从哪来"。
  // 预览上的悬停角标随编辑模式一起去掉了（2026-10-21），标注数据本身仍然有效。
  const factAnnotations = useMemo(() => detail.fact_annotations ?? [], [detail.fact_annotations]);

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
      <ResumeLayoutDiagnosisCard
        resumeId={detail.id}
        measure={measure}
        overflow={layoutStatus?.overflow ?? false}
        previewRef={resolvedPreviewRef}
        layout={layout}
        disabled={relayouting}
        onApplied={(formatConfig) => onApplyFittedFormat(formatConfig)}
        onAddPage={() => onApplyLayout({ ...layout, page_limit: layout.page_limit + 1 })}
      />
      {/* 「没写进这份简历」的中性分组（#3/#5）：与"疑似虚构"分开呈现，并给出处理入口。 */}
      {(coverageNotes.length > 0 || legacyCoverageWarnings.length > 0) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="这些资料内容没有写进这份简历"
          description={
            <div style={{ display: "grid", gap: 10 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                这是岗位导向筛选的正常结果：与岗位关键词交集不足的内容不会进入生成，资料本身没有任何丢失。
              </Typography.Text>
              {coverageNotes.map((note) => (
                <div key={note.section}>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {note.section_label}（{note.total} 条）：
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 13 }}>
                    {note.names.map((name) => `「${name}」`).join("、")}
                  </Typography.Text>
                  <Space size={8} style={{ marginTop: 6 }} wrap>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      onClick={() => {
                        setReviseInstructions(
                          `请把资料中的以下内容补进这份简历的${note.section_label}（只新增这些内容，其余部分保持不变）：` +
                            note.names.map((name) => `「${name}」`).join("、") +
                            "。补充时使用这些条目在个人资料中的原文事实，不要虚构细节。",
                        );
                        setReviseOpen(true);
                      }}
                    >
                      AI 补上这段
                    </Button>
                  </Space>
                </div>
              ))}
              {legacyCoverageWarnings.map((warning) => (
                <Typography.Paragraph key={warning} style={{ margin: 0, fontSize: 13 }}>
                  {warning}
                </Typography.Paragraph>
              ))}
              {coverageNotes.length > 0 && (
                <Space size={8} wrap>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditorTarget(null);
                      setEditorOpen(true);
                    }}
                  >
                    打开手动调整
                  </Button>
                </Space>
              )}
            </div>
          }
        />
      )}
      {/* 事实来源展示（RF-13）：与"没写进简历"分开——它回答的是"写进去的内容
          从哪来"，挂在 coverage Alert 之后、预览之前，先看筛选结果再看来源。 */}
      {factAnnotations.length > 0 && (
        <EvidencePanel annotations={factAnnotations} content={detail.content} />
      )}
      <ResumePreview
        ref={resolvedPreviewRef}
        // 两个具名插槽（P2 / D4）：结构类在工具栏第一行，度量类在第二行。
        // 目录由本组件取**一次**（`useResumeTemplateCatalog`），两组共用——各取一次就是两个请求。
        // 渲染中**不禁用**（D12）：禁用是"丢弃"的另一种写法（用户拖不动 → 以为坏了），
        // 边距合并已经保证"最后一次一定生效"，禁用只会制造"卡"的体感。
        templateControls={
          // 与「岗位详情 → AI 生成」用**同一套**版式控件（非 compact）：两处的
          // 分组标签、控件尺寸、两行两列的排布必须一致，否则同一件事在两条入口里
          // 长得不一样（2026-10-20 用户反馈）。
          <ResumeTemplateControls
            layout={layout}
            resumeId={detail.id}
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
        onOpenExportOptions={() => setExportOptionsOpen(true)}
      />

      <ResumeEditorModal
        open={editorOpen}
        content={detail.content}
        initialTarget={editorTarget}
        // 传 resumeId 才会挂出「写作增强」页签（STAR 量化改写 / 话术生成器 / 多风格润色 /
        // 中英互译）——那几个接口都按简历 id 调。此前这里没传，于是后端与组件都齐了、
        // 界面上却点不到，而 README 与使用指南都写着它可用。
        resumeId={detail.id}
        onClose={() => {
          setEditorOpen(false);
          setEditorTarget(null);
        }}
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
      {/* 修订弹窗（承载「AI 补上这段」与「采纳建议」）只看 onResumeRevised 是否传入：
          生成弹窗的预览阶段虽然藏起底部「AI 修改 / 重新生成」按钮（showReviseAction=false，
          避免与它自己的「重新生成」向导重复），但「AI 补上这段」仍要能弹出修订窗口。 */}
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
      <ExportOptionsModal
        recordId={detail.id}
        open={exportOptionsOpen}
        // 页数/字号/版式草稿全部带上：否则导出弹窗发的是"不指定"，由后端取记录里存的旧值——
        // 用户在预览里把字号拖到 7px、页数改成 2、还没保存就导出，就会得到与眼前不同的文件。
        initialPageLimit={layout.page_limit}
        initialFontScale={layout.font_scale}
        initialFormatConfig={layout.format_config}
        // 语言也是草稿：预览里切成 English 还没保存时，导出必须印英文标题。
        // 回落值与预览发给 /render 的那份一致（zh-CN），否则两边会各说各的。
        initialLanguage={layout.language ?? "zh-CN"}
        pdfDirectAvailable={pdfDirectAvailable}
        onClose={() => setExportOptionsOpen(false)}
      />
      <ResumeZoomModal
        open={zoomOpen}
        html={html}
        warnings={detail.warnings}
        pages={layout.page_limit}
        layout={layout}
        resumeId={detail.id}
        relayouting={relayouting}
        hasPhoto={Boolean(detail.content?.photo)}
        onApplyLayout={onApplyLayout}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        exactPreview={exactPreview}
        onClose={() => setZoomOpen(false)}
        onExport={() => {
          setZoomOpen(false);
          setExportOptionsOpen(true);
        }}
      />
      <SharePackageModal
        recordId={detail.id}
        open={sharePackageOpen}
        onClose={() => setSharePackageOpen(false)}
      />
    </div>
  );
}
