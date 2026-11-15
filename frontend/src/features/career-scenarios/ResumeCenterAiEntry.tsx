// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心筛选栏的「AI 生成」按钮：只发"打开通用生成弹窗"信号（弹窗由场景建议卡组件持有）。
 *
 * 刻意**不写** `aria-label`：可访问名直接取可见文字。
 * axe 的 `label-content-name-mismatch`（serious）要求可访问名**包含**可见文字，
 * 而 en 的 "Generate a Resume with AI" 与可见文字 "Generate with AI" 不构成包含关系，
 * 英文界面会被判红（zh 恰好是子串所以中文跑不出来）。删掉 aria-label 后两边都满足，
 * 也少一条"文案改一处、aria 忘改一处"的漂移点。
 */
import { Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { triggerResumeCenterAiGenerate } from "./resumeCenterAiBus";

export default function ResumeCenterAiEntry() {
  useLocale();
  return (
    <Button onClick={triggerResumeCenterAiGenerate}>
      {t("careerScenarios.center.aiGenerate")}
    </Button>
  );
}
