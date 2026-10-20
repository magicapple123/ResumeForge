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
import {
  BulbOutlined,
  EditOutlined,
  ZoomInOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Collapse, Space, Tag, Tooltip, Typography } from "antd";
import { Alert } from "antd";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { RESUME_ENHANCEMENT_LEVELS } from "../../config";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../../types";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import { contentSignature } from "../../utils/contentSignature";
import ExportButtons from "../ExportButtons";
import ExportOptionsModal from "../ExportOptionsModal";
import { describeResumeFieldPath } from "../../utils/resumeFieldPath";
import ResumeFieldQuickEditModal from "./ResumeFieldQuickEditModal";
import ResumeZoomModal from "./ResumeZoomModal";
import ResumeEditorModal from "../ResumeEditorModal";
import ResumeLayoutControls from "../ResumeLayoutControls";
import { useShortcut } from "../../features/shortcuts/useShortcutKeymap";
import ResumeQualityModal from "../ResumeQualityModal";
import ResumeSuggestionsModal from "../ResumeSuggestionsModal";
import ResumeReviseModal from "./ResumeReviseModal";
import SharePackageModal from "../SharePackageModal";
import ResumePreview, { type ResumePreviewHandle } from "../ResumePreview";
import ResumeLayoutDiagnosisCard from "./ResumeLayoutDiagnosisCard";
import EvidencePanel from "./EvidencePanel";
import { ORIGIN_LABELS } from "./factAnnotationMeta";
import type { FactAnnotation } from "../../types";

interface LayoutStatus {
  pages: number;
  scale: number;
  overflow: boolean;
}

/** 把一条标注压成预览角标需要的形状（label 显示在角标上，其余进 Popover）。 */
function toBadge(annotation: FactAnnotation): {
  label: string;
  sourceFact: string;
  boundary: string;
} {
  return {
    label: ORIGIN_LABELS[annotation.origin] ?? annotation.origin,
    sourceFact: annotation.source_fact ?? "",
    boundary: annotation.boundary ?? "",
  };
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
  // 「只编辑选中的这一部分」：预览里点中哪一栏就只改哪一栏（与「手动调整」分开）。
  const [quickEditPath, setQuickEditPath] = useState<string | null>(null);
  const [sharePackageOpen, setSharePackageOpen] = useState(false);
  // 内部再包一层引用：父组件可能传 null（尚未量到），子组件需要一份稳定的 ref 传入 ResumePreview。
  const fallbackRef = useRef<ResumePreviewHandle>(null);
  const resolvedPreviewRef = previewRef ?? fallbackRef;
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
  // 事实来源标注（RF-13）：证据面板 + 预览角标共用同一份数据。
  const factAnnotations = useMemo(() => detail.fact_annotations ?? [], [detail.fact_annotations]);
  // 悬停路径（`experience.0.description.1`）与标注路径（`experience.0.description`）
  // 不是同一粒度：精确命中优先，否则取最长前缀的标注——指向条目里的某一条要点时，
  // 说得出来源的是它所属的那一栏。
  const describeAnnotation = useCallback(
    (path: string): { label: string; sourceFact: string; boundary: string } | null => {
      let best: FactAnnotation | null = null;
      for (const annotation of factAnnotations) {
        if (annotation.path === path) return toBadge(annotation);
        if (
          path.startsWith(`${annotation.path}.`) &&
          (best === null || annotation.path.length > best.path.length)
        ) {
          best = annotation;
        }
      }
      return best ? toBadge(best) : null;
    },
    [factAnnotations],
  );

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
          message="这些资料内容没有写进这份简历"
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
        toolbarExtra={
          <>
            <ResumeLayoutControls
              compact
              layout={layout}
              resumeId={detail.id}
              disabled={relayouting}
              previewRef={resolvedPreviewRef}
              onChange={(next) => onApplyLayout(next)}
            />
            {relayouting ? (
              <Typography.Text type="secondary">正在按新版式渲染…</Typography.Text>
            ) : null}
          </>
        }
        html={html}
        pages={layout.page_limit}
        warnings={fabricationWarnings}
        onLayoutStatus={onLayoutStatus}
        onMeasure={onMeasure}
        // 鼠标划过纸面时，工具栏要说出"现在指向的是哪一栏"——这要靠简历内容才起得准
        // （没有内容只能说出「项目经历的第 2 条要点」，说不出是哪个项目）。
        describePath={(path) => describeResumeFieldPath(path, detail.content)}
        // 带标注的路径在悬停工具栏上加一枚来源角标（悬停可看依据与边界）。
        describeAnnotation={describeAnnotation}
        // 预览里点中的那一栏 → 只编辑这一栏（快速编辑），不打开整份编辑器。
        // 通读、跨栏改、写作增强都留给「手动调整」。
        onEditTarget={(path) => setQuickEditPath(path)}
      />
      {/* 固定在弹窗底部：内容长（版面诊断 + 预览）时不必一路翻到最后才够得着这些按钮。
          按钮区是 CSS Grid：每个按钮独占一格、block 拉满整格，自动铺满整行不留右侧空当；
          「下载 PDF」主按钮独占底部一整行，保持醒目。 */}
      <div className="resume-detail-footer">
        <Button
          block
          icon={<EditOutlined />}
          onClick={() => {
            setEditorTarget(null);
            setEditorOpen(true);
          }}
        >
          手动调整
        </Button>
        <Button block icon={<ZoomInOutlined />} onClick={() => setZoomOpen(true)}>
          查看大图
        </Button>
        {showRevise && (
          <Button block icon={<ThunderboltOutlined />} onClick={() => setReviseOpen(true)}>
            AI 修改 / 重新生成
          </Button>
        )}
        <Button
          block
          icon={<BulbOutlined />}
          disabled={!detail.job_id}
          onClick={() => setSuggestionsOpen(true)}
        >
          {suggestionsGenerated ? "查看岗位优化建议" : "生成岗位优化建议"}
        </Button>
        <Button
          block
          icon={<FolderOpenOutlined />}
          disabled={!detail.job_id}
          onClick={() => detail.job_id && navigate(`/jobs?job_id=${detail.job_id}`)}
        >
          查看对应岗位
        </Button>
        <Button
          block
          icon={<MessageOutlined />}
          onClick={() => navigate(`/assistant?resume_id=${detail.id}&new=1`)}
        >
          咨询求职助手
        </Button>
        <Button block icon={<SafetyCertificateOutlined />} onClick={() => setQualityOpen(true)}>
          质量检测
        </Button>
        <Button block icon={<ShareAltOutlined />} onClick={() => setSharePackageOpen(true)}>
          离线分享
        </Button>
        {/* 额外操作（取消修改 / 保存修改）单独占一行：它们是"这一轮版式改动"的确认动作，
            挤进 150px 的格子里会把两个按钮压成两行。 */}
        {extraActions ? <div className="resume-detail-footer-extra-row">{extraActions}</div> : null}
        {/* 导出放在最后：网格里 `-2 / -1` 让它落到「离线分享」所在行的最后一格，
            也就是整张卡的右下角。 */}
        <div className="resume-detail-footer-export">
          <ExportButtons
            recordId={detail.id}
            layout={layout}
            pdfDirectAvailable={pdfDirectAvailable}
            onOpen={() => setExportOptionsOpen(true)}
          />
        </div>
      </div>

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
        pdfDirectAvailable={pdfDirectAvailable}
        onClose={() => setExportOptionsOpen(false)}
      />
      <ResumeFieldQuickEditModal
        open={quickEditPath !== null}
        resumeId={detail.id}
        content={detail.content}
        path={quickEditPath}
        onClose={() => setQuickEditPath(null)}
        onSaved={onSaveEditedResume}
      />
      <ResumeZoomModal
        open={zoomOpen}
        html={html}
        warnings={detail.warnings}
        pages={layout.page_limit}
        layout={layout}
        resumeId={detail.id}
        relayouting={relayouting}
        onApplyLayout={onApplyLayout}
        describePath={(path) => describeResumeFieldPath(path, detail.content)}
        onClose={() => setZoomOpen(false)}
        onEditTarget={(path) => {
          setZoomOpen(false);
          setQuickEditPath(path);
        }}
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
