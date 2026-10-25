// SPDX-License-Identifier: Apache-2.0
/** 简历中心筛选栏的「AI 生成」按钮：只发"打开通用生成弹窗"信号（弹窗由场景建议卡组件持有）。 */
import { Button } from "antd";
import { t } from "../../i18n";
import { triggerResumeCenterAiGenerate } from "./resumeCenterAiBus";

export default function ResumeCenterAiEntry() {
  return (
    <Button
      onClick={triggerResumeCenterAiGenerate}
      aria-label={t("careerScenarios.center.aiGenerateAria")}
    >
      {t("careerScenarios.center.aiGenerate")}
    </Button>
  );
}
