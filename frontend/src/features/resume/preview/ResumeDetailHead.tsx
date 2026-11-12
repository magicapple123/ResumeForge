// SPDX-License-Identifier: Apache-2.0
/**
 * 详情预览的**顶部信息区**（2026-11 问题 8）：元信息一行 + 诊断条一行。
 *
 * 为什么单独成文件：`ResumeDetailPreview` 贴着 500 行预算，而这一块是"压高度"的主战场
 * （原来 12 段元信息 = ≈690px，把 A4 纸面推到首屏之外）。抽出来之后宿主只管"下面有什么"，
 * 这一层只管"上面怎么排"。
 *
 * 三条产品口径写在代码里，别在别处再实现一遍：
 * - Tag 只留**有区分度**的（来源 / 通用简历 / 美化档位）；目标岗位与公司已经在 `detail.title`
 *   里，不再用 Tag 复述；模型、创建时间、求职意向降级成 `·` 分隔的次要文本。
 * - 「本次使用」「独立版本」「关联岗位」由宿主从 `metaExtra` 插进来，排在同一行末尾。
 * - 「生成说明 / 版面诊断 / 未收录 / 来源」是四个**入口**，内容进弹层：一块都没删，
 *   只是不再各占一段高度（细节见 `ResumeDiagnosticsBar`）。
 */
import { Tag, Tooltip, Typography } from "antd";
import type { ReactNode, RefObject } from "react";
import { useCallback, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { RESUME_ENHANCEMENT_LEVELS } from "../../../config";
import type {
  FactAnnotation,
  ResumeCoverageNote,
  ResumeDetail,
  ResumeLayout,
  ResumeLayoutStatus,
} from "../../../types";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import type { ResumePreviewHandle } from "./ResumePreview";
import ResumeDiagnosticsBar from "./ResumeDiagnosticsBar";
import ResumeLayoutDiagnosisCard from "../layout/ResumeLayoutDiagnosisCard";
import { ResumeCoverageNotesBody } from "../document/ResumeCoverageNotes";
import { coverageSummaryCount } from "../document/coverageGroups";
import {
  layoutFillLabel,
  layoutFillPercent,
  layoutNeedsAttention,
} from "../layout/layoutStatusSummary";
import RationaleParagraphs from "./rationaleParagraphs";
import EvidencePanel from "../document/EvidencePanel";
import { formatServerTime } from "../../../utils/serverTime";

interface Props {
  detail: ResumeDetail;
  /** 预览量到的实测高度；还没渲染完时为 null（诊断入口据此决定要不要出现）。 */
  measure: LayoutMeasure | null;
  layoutStatus: { overflow: boolean } | null;
  layout: ResumeLayout;
  relayouting: boolean;
  previewRef: RefObject<ResumePreviewHandle | null>;
  /** 宿主追加的元信息（关联岗位链接 / 本次使用 / 版本血缘与投递记录）。 */
  metaExtra?: ReactNode;
  coverageNotes: ResumeCoverageNote[];
  legacyCoverageWarnings: string[];
  factAnnotations: FactAnnotation[];
  onApplyLayout: (next: ResumeLayout) => void;
  onApplyFittedFormat: (formatConfig: ResumeFormatConfig) => void;
  /** 「AI 补上这段」：把拼好的指令交给宿主的修订弹窗。 */
  onRevise: (instructions: string) => void;
  /** 「打开手动调整」：宿主负责打开制作台。 */
  onOpenEditor: () => void;
  /** 3-A：当前简历 id（透传给覆盖度清单的「补进简历」）。 */
  resumeId?: number;
  /** 3-A：补入成功后的新简历（透传给覆盖度清单，宿主负责刷新）。 */
  onAppended?: (detail: ResumeDetail) => void;
}

export default function ResumeDetailHead({
  detail,
  measure,
  layoutStatus,
  layout,
  relayouting,
  previewRef,
  metaExtra,
  coverageNotes,
  legacyCoverageWarnings,
  factAnnotations,
  onApplyLayout,
  onApplyFittedFormat,
  onRevise,
  onOpenEditor,
  resumeId,
  onAppended,
}: Props) {
  useLocale();
  const enhancementLabelKey = RESUME_ENHANCEMENT_LEVELS.find(
    (item) => item.value === detail.enhancement_level,
  )?.labelKey;
  /** 美化拓展那一格的取值：没开启就写「未开启」，开了但没记录档位就只写「已开启」。 */
  const enhancementLevelText = !detail.enhancement_enabled
    ? t("resumes.list.off")
    : enhancementLabelKey
      ? t(enhancementLabelKey)
      : t("resumes.list.on");
  /**
   * 诊断结论只有版面诊断卡算得出来（阈值在后端），所以由卡片回调上来；卡片还没算出来
   * （弹层没打开过）时，退一步只显示**本地能算的占用率**。
   *
   * 占用率公式、阈值与文案 key 都在 `layoutStatusSummary` 里（#24 24C）：制作台左栏那条
   * 常驻状态条读的是同一份实现——两处各写一遍是 2026-11 反复出现的"数字打架"来源。
   */
  const [diagnosisInfo, setDiagnosisInfo] = useState<{
    status: ResumeLayoutStatus;
    statusLabel: string;
    fill: number;
  } | null>(null);
  // 稳定身份：卡片把回调放进 ref，这里仍用 useCallback 免得每次渲染都换引用。
  const handleDiagnosisChange = useCallback(
    (info: { status: ResumeLayoutStatus; statusLabel: string; fill: number } | null) =>
      setDiagnosisInfo(info),
    [],
  );
  const localFillPercent = layoutFillPercent(measure);
  const diagnosisBadge = diagnosisInfo
    ? `${diagnosisInfo.statusLabel} · ${t("resume.diagnosis.fill", {
        percent: Math.round(diagnosisInfo.fill * 100),
      })}`
    : layoutFillLabel(measure);
  // 琥珀语义（问题 8 的风险项）：偏空 / 拥挤 / 溢出都要留颜色信号，健康与未知不留。
  const diagnosisAttention = layoutNeedsAttention({
    status: diagnosisInfo?.status ?? null,
    overflow: Boolean(layoutStatus?.overflow),
    fillPercent: localFillPercent,
  });
  const coverageCount = coverageSummaryCount(coverageNotes, legacyCoverageWarnings);
  return (
    <>
      <div className="resume-meta-line">
        <Tag color={detail.source === "manual" ? "purple" : "blue"}>
          {detail.source === "manual" ? t("resumes.list.sourceManual") : t("resumes.list.sourceAi")}
        </Tag>
        {detail.job_id ? null : (
          <Tooltip title={t("resumes.list.generalHint")}>
            <Tag color="purple">{t("resumes.list.general")}</Tag>
          </Tooltip>
        )}
        {detail.enhancement_enabled ? (
          <Tag color="green">
            {t("appConfig.detail.enhancement", { level: enhancementLevelText })}
          </Tag>
        ) : null}
        <Typography.Text type="secondary" className="resume-meta-line-detail">
          {[
            t("appConfig.detail.model", { model: detail.model || "-" }),
            t("appConfig.detail.createdAt", {
              time: formatServerTime(detail.created_at),
            }),
            // 通用简历没有岗位：求职意向存在 job_title 里，压成次要文本保住这条信息
            // （标题里通常也有，但旧记录的标题可能只有人名）。
            detail.job_id
              ? null
              : t("resumes.list.intent", {
                  job: detail.job_title || t("appConfig.detail.notFilled"),
                }),
          ]
            .filter((part): part is string => Boolean(part))
            .join(" · ")}
        </Typography.Text>
        {metaExtra}
      </div>
      <ResumeDiagnosticsBar
        diagnosis={
          measure
            ? {
                content: (
                  <ResumeLayoutDiagnosisCard
                    resumeId={detail.id}
                    measure={measure}
                    overflow={layoutStatus?.overflow ?? false}
                    previewRef={previewRef}
                    layout={layout}
                    disabled={relayouting}
                    onApplied={(formatConfig) => onApplyFittedFormat(formatConfig)}
                    onAddPage={() =>
                      onApplyLayout({ ...layout, page_limit: layout.page_limit + 1 })
                    }
                    // v2 下「按诊断建议改正文」的入口先关掉：它写回的是 v1 分区结构，会把 v2
                    // 文档打回旧模型。等版面优化器迁到 v2 item 后再接回来。
                    onDiagnosisChange={handleDiagnosisChange}
                  />
                ),
                badge: diagnosisBadge,
                attention: diagnosisAttention,
              }
            : null
        }
        coverage={
          coverageCount > 0
            ? {
                count: coverageCount,
                content: (
                  <ResumeCoverageNotesBody
                    notes={coverageNotes}
                    legacyWarnings={legacyCoverageWarnings}
                    onRevise={onRevise}
                    onOpenEditor={onOpenEditor}
                    // 3-A：只有两个都到位时清单才敢出「补进简历」；`detail.revision`
                    // 就是条件写要的前置版本（透传，不在这里加别的逻辑）。
                    resumeId={resumeId}
                    baseRevision={detail.revision ?? null}
                    onAppended={onAppended}
                  />
                ),
              }
            : null
        }
        evidence={
          factAnnotations.length > 0
            ? {
                count: factAnnotations.length,
                // 弹层里不再套一层折叠（`embedded`）：入口本身就是"展开"。
                content: (
                  <EvidencePanel
                    embedded
                    annotations={factAnnotations}
                    content={detail.content as never}
                  />
                ),
              }
            : null
        }
        rationale={detail.rationale ? <RationaleParagraphs text={detail.rationale} /> : null}
      />
    </>
  );
}
