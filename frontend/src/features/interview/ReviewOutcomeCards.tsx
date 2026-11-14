// SPDX-License-Identifier: Apache-2.0
/**
 * 报告下半部分：旧版纯文本记录的兼容提示，或本次的建议列表。
 *
 * 从 `InterviewReviewPanel` 拆出：面板已贴 500 行预算，而这块只看 props。
 * 组件内用模块级 `t()`，所以必须订阅语言变化（`useLocale()`），否则切语言不重渲染。
 */
import { Alert, Card, Typography } from "antd";

import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewOptimizeResult } from "../../types";
import SuggestionsCard from "./SuggestionsCard";

export default function ReviewOutcomeCards({
  legacyText,
  suggestions,
  onGoToResume,
}: {
  legacyText: string | null;
  suggestions: InterviewOptimizeResult["suggestions"];
  onGoToResume?: () => void;
}) {
  useLocale();

  if (legacyText) {
    return (
      <Card size="small" title={t("interviewReview.card.legacy")}>
        <Alert
          type="warning"
          showIcon
          title={t("interviewReview.legacy.title")}
          description={t("interviewReview.legacy.body")}
        />
        <Typography.Paragraph style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
          {legacyText}
        </Typography.Paragraph>
      </Card>
    );
  }
  if (suggestions.length === 0) return null;
  return <SuggestionsCard suggestions={suggestions} onGoToResume={onGoToResume} />;
}
