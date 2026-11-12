// SPDX-License-Identifier: Apache-2.0
/**
 * 一条事实来源标注的**渲染件**（RF-13 / #24 24E 抽出）。
 *
 * 两个宿主共用它：
 * - `EvidencePanel`（整份简历的"内容来源说明"，弹层里按分区列出全部标注）；
 * - `FactSourceBadge`（中栏字段旁那颗徽标点开后的弹层，只放这一条）。
 *
 * 抽出来的直接原因是 #24 24E 的硬约束："点开能看来源原文，复用现有证据渲染，不要新写
 * 一套"。徽标弹层如果自己拼一遍 Tag 与"依据 / 个人边界"两行，色板与 key 就会分叉——
 * 同一段内容在两处显示不同的来源色，正是这条要消灭的东西。
 *
 * `content` 同时接受 v1 `ResumeContent` 与 v2 `ResumeDocument`：`describeResumeFieldPath`
 * 两种形状都能解析（v2 走 `isDocument` 分支），而徽标的宿主手里只有 v2 文档。
 */
import { Space, Tag, Typography } from "antd";
import { useI18n } from "../../../i18n/i18nContext";
import type { FactAnnotation, ResumeContent } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { claimResponsibilityColor, claimStatusColor } from "../../claims/claimPresentation";
import { claimResponsibilityLabelKey, claimStatusLabelKey } from "../../../i18n/enum/claims";
import { describeResumeFieldPath } from "../../../utils/resumeFieldPath";
import { ORIGIN_COLORS, ORIGIN_LABELS, canShowVerified } from "./factAnnotationMeta";

export interface FactAnnotationItemProps {
  annotation: FactAnnotation;
  /** 用来把 `path` 翻成人话（"教育经历 · 清华大学 的 学校"）；拿不到就只显示原路径。 */
  content?: ResumeContent | ResumeDocument | null;
}

export default function FactAnnotationItem({
  annotation,
  content = null,
}: FactAnnotationItemProps) {
  const { t } = useI18n();
  const verified = canShowVerified(annotation) ? annotation.verification_status : null;
  // 标注里的状态/承担程度是后端下发的协议值：映射到语言包，
  // 认不出的取值回退原样显示（不丢信息）。
  const verifiedKey = verified ? claimStatusLabelKey(verified) : undefined;
  const responsibilityKey = claimResponsibilityLabelKey(annotation.responsibility ?? "");
  const originKey = ORIGIN_LABELS[annotation.origin];
  return (
    <div className="resume-fact-annotation" style={{ fontSize: 13, lineHeight: 1.7 }}>
      <Space size={6} wrap>
        <Typography.Text style={{ fontSize: 13 }}>
          {describeResumeFieldPath(annotation.path, content)}
        </Typography.Text>
        <Tag color={ORIGIN_COLORS[annotation.origin] ?? "default"} style={{ marginInlineEnd: 0 }}>
          {originKey ? t(originKey) : annotation.origin}
        </Tag>
        {verified && (
          <Tag color={claimStatusColor(verified)}>{verifiedKey ? t(verifiedKey) : verified}</Tag>
        )}
        {annotation.responsibility && (
          <Tag color={claimResponsibilityColor(annotation.responsibility)}>
            {responsibilityKey ? t(responsibilityKey) : annotation.responsibility}
          </Tag>
        )}
      </Space>
      {annotation.source_fact && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "2px 0 0" }}>
          {t("resume.evidence.basis", { fact: annotation.source_fact })}
        </Typography.Paragraph>
      )}
      {annotation.boundary && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "2px 0 0" }}>
          {t("resume.evidence.boundary", { boundary: annotation.boundary })}
        </Typography.Paragraph>
      )}
    </div>
  );
}
