// SPDX-License-Identifier: Apache-2.0
/**
 * 事实来源展示（RF-13）：按分区渲染一份简历的 fact_annotations。
 *
 * 回答"这份简历里的每段内容是从哪条资料事实来的"：grounded（锚定到资料原文）/
 * restored（匹配失败回填原文）/ enhanced_kept（AI 美化改写被保留）。标注由生成
 * 链路纯收集产出，不调模型；旧记录没有标注，本面板不渲染。
 *
 * 两条硬规则：
 * - Tag 色板复用 claims 组件的同一份（STATUS_COLORS / RESPONSIBILITY_COLORS）——
 *   同一状态在台账和预览里必须同色；
 * - AI 改写（enhanced_kept / ai_rewrite）**永不显示为已确认**——即使标注里带了
 *   verification_status="已确认"（防御性：正常链路不会带），渲染层也要压掉。
 */
import { Collapse, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import { claimResponsibilityColor, claimStatusColor } from "../claims/claimPresentation";
import { describeResumeFieldPath } from "../../utils/resumeFieldPath";
import type { FactAnnotation, ResumeContent } from "../../types";
import { ORIGIN_COLORS, ORIGIN_LABELS, canShowVerified } from "./factAnnotationMeta";

const SECTION_ORDER = [
  "summary",
  "education",
  "experience",
  "campus_experience",
  "projects",
  "skills",
  "awards",
] as const;

const SECTION_TITLES: Record<string, string> = {
  summary: "个人总结",
  education: "教育经历",
  experience: "实习/工作经历",
  campus_experience: "校园经历",
  projects: "项目经历",
  skills: "专业技能",
  awards: "荣誉奖项",
};

interface Props {
  annotations: FactAnnotation[] | undefined;
  content: ResumeContent;
}

export default function EvidencePanel({ annotations, content }: Props) {
  const grouped = useMemo(() => {
    const result: { section: string; title: string; items: FactAnnotation[] }[] = [];
    const bySection = new Map<string, FactAnnotation[]>();
    for (const annotation of annotations ?? []) {
      const section = annotation.path.split(".")[0] ?? "";
      const bucket = bySection.get(section);
      if (bucket) bucket.push(annotation);
      else bySection.set(section, [annotation]);
    }
    for (const section of SECTION_ORDER) {
      const items = bySection.get(section);
      if (items?.length) {
        result.push({ section, title: SECTION_TITLES[section] ?? section, items });
        bySection.delete(section);
      }
    }
    // 未识别的分区兜底按字母序排尾部，保证"分区清单前后不变"只对已知分区承诺。
    for (const section of [...bySection.keys()].sort()) {
      result.push({
        section,
        title: SECTION_TITLES[section] ?? section,
        items: bySection.get(section)!,
      });
    }
    return result;
  }, [annotations]);

  if (!annotations?.length) return null;

  // 默认折叠（R8）：这份说明是"想核对时再看"的辅助信息，但一段简历动辄十几条标注，
  // 平铺展开会把预览正文挤到屏幕外。折叠成一行标题 + 条数徽标，需要时一点即开。
  return (
    <div className="resume-evidence-panel" data-testid="evidence-panel">
      <Collapse
        size="small"
        defaultActiveKey={[]}
        items={[
          {
            key: "evidence",
            label: (
              <Typography.Text strong style={{ fontSize: 13 }}>
                内容来源说明 · {annotations.length} 条
              </Typography.Text>
            ),
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  这些内容来自你的个人资料；AI 改写过的部分永远不显示为"已确认"，建议导出前过目。
                </Typography.Paragraph>
                <div style={{ display: "grid", gap: 8 }}>
                  {grouped.map((group) => (
                    <div key={group.section}>
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {group.title}
                      </Typography.Text>
                      <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                        {group.items.map((annotation) => {
                          const verified = canShowVerified(annotation)
                            ? annotation.verification_status
                            : null;
                          return (
                            <div
                              key={`${annotation.path}:${annotation.origin}`}
                              style={{ fontSize: 13, lineHeight: 1.7 }}
                            >
                              <Space size={6} wrap>
                                <Typography.Text style={{ fontSize: 13 }}>
                                  {describeResumeFieldPath(annotation.path, content)}
                                </Typography.Text>
                                <Tag
                                  color={ORIGIN_COLORS[annotation.origin] ?? "default"}
                                  style={{ marginInlineEnd: 0 }}
                                >
                                  {ORIGIN_LABELS[annotation.origin] ?? annotation.origin}
                                </Tag>
                                {verified && (
                                  <Tag color={claimStatusColor(verified)}>{verified}</Tag>
                                )}
                                {annotation.responsibility && (
                                  <Tag color={claimResponsibilityColor(annotation.responsibility)}>
                                    {annotation.responsibility}
                                  </Tag>
                                )}
                              </Space>
                              {annotation.source_fact && (
                                <Typography.Paragraph
                                  type="secondary"
                                  style={{ fontSize: 12, margin: "2px 0 0" }}
                                >
                                  依据：{annotation.source_fact}
                                </Typography.Paragraph>
                              )}
                              {annotation.boundary && (
                                <Typography.Paragraph
                                  type="secondary"
                                  style={{ fontSize: 12, margin: "2px 0 0" }}
                                >
                                  个人边界：{annotation.boundary}
                                </Typography.Paragraph>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
