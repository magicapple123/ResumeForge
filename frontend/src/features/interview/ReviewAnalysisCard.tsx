// SPDX-License-Identifier: Apache-2.0
/** 面试复盘第二步：答题思路 + 可编辑的短板/追问 + 反向优化入口。
 *
 * 从 InterviewReviewPanel 拆出（Q3）。拆出去的是**整块答题思路卡**：它同时承担"展示模型
 * 结果"和"收集反向优化的两个输入"，与设定卡的状态互不相干，放在一起只会让两边都读不下去。
 *
 * 两个输入框（短板 / 追问）是**唯一**的优化入口（历史查看态也一样）：过去它们是只读
 * `<ul>`，用户看得见却改不了，点「反向优化」只会撞后端 422。
 */
import { SaveOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Card, Input, Space, Typography } from "antd";
import type { ReactNode } from "react";
import AbortButton from "../../components/common/AbortButton";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { OPTIMIZE_ITEM_LIMIT } from "./normalizeReview";
import type { InterviewAnalysis } from "../../types";

export default function ReviewAnalysisCard({
  analysis,
  weaknessesText,
  followUpsText,
  onWeaknessesChange,
  onFollowUpsChange,
  truncated,
  canOptimize,
  optimizing,
  onOptimize,
  onAbort,
  resumeField,
  onSave,
  saving,
  resetKey,
}: {
  analysis: InterviewAnalysis;
  /** 两个输入框的文本（`\n` 分隔）；空串表示"没填过"。 */
  weaknessesText: string;
  followUpsText: string;
  onWeaknessesChange: (text: string) => void;
  onFollowUpsChange: (text: string) => void;
  /** 超过后端 `MAX_OPTIMIZE_ITEMS`：已截断，提示用户而不是等 422。 */
  truncated: boolean;
  canOptimize: boolean;
  optimizing: boolean;
  onOptimize: () => void;
  onAbort: () => void;
  /** 历史查看态才在这里补一次简历来源；新建时的在设定卡里。 */
  resumeField?: ReactNode;
  /** 只有"刚生成的分析"才需要手点保存；历史记录已经是保存过的。 */
  onSave?: () => void;
  saving?: boolean;
  /** 切记录时重挂载输入框（自动高度的内部状态不跨记录）。 */
  resetKey: string | number;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Card size="small" title={t("interviewReview.card.analysis")}>
      <Typography.Paragraph strong>{analysis.framework}</Typography.Paragraph>
      {analysis.key_points.length > 0 && (
        <>
          <Typography.Text strong>{t("interviewReview.section.keyPoints")}</Typography.Text>
          <ul>
            {analysis.key_points.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <div key={resetKey} style={{ marginTop: 8 }}>
        <Typography.Text strong>{t("interviewReview.field.weaknesses")}</Typography.Text>
        <Input.TextArea
          aria-label={t("interviewReview.field.weaknesses")}
          value={weaknessesText}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder={t("interviewReview.placeholder.weaknesses")}
          onChange={(event) => onWeaknessesChange(event.target.value)}
          style={{ marginTop: 4, marginBottom: 12 }}
        />
        <Typography.Text strong>{t("interviewReview.field.followUps")}</Typography.Text>
        <Input.TextArea
          aria-label={t("interviewReview.field.followUps")}
          value={followUpsText}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder={t("interviewReview.placeholder.followUps")}
          onChange={(event) => onFollowUpsChange(event.target.value)}
          style={{ marginTop: 4 }}
        />
        {truncated && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="warning">
              {t("interviewReview.optimize.truncated", { limit: OPTIMIZE_ITEM_LIMIT })}
            </Typography.Text>
          </div>
        )}
      </div>
      {resumeField && <div style={{ marginTop: 12 }}>{resumeField}</div>}
      <Space wrap style={{ marginTop: 12 }}>
        <Button
          icon={<ThunderboltOutlined />}
          loading={optimizing}
          disabled={!canOptimize}
          onClick={onOptimize}
        >
          {t("interviewReview.action.optimize")}
        </Button>
        {optimizing && <AbortButton onClick={onAbort} />}
        {onSave && (
          <Button icon={<SaveOutlined />} loading={saving} onClick={onSave}>
            {t("interviewReview.action.save")}
          </Button>
        )}
        <Typography.Text type="secondary">{t("interviewReview.optimize.note")}</Typography.Text>
      </Space>
      {!canOptimize && (
        // 三档数据过去只由模型产出，历史记录里常常两个数组都空；
        // 说清"该怎么让它变可点"，而不是让用户对着灰按钮猜。
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">
            {t("interviewReview.optimize.needInput")}
          </Typography.Text>
        </div>
      )}
    </Card>
  );
}
