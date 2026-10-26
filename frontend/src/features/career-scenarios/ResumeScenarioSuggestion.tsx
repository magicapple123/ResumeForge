// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心列表顶部的场景建议卡 + 通用简历生成弹窗（A2）。
 *
 * 两个入口（筛选栏的「AI 生成」按钮、本卡的「AI 生成通用简历」）共享同一个弹窗实例：
 * 弹窗状态与挂载都在这里，按钮经模块级登记表发"打开"信号（见 resumeCenterAiEntry.ts）。
 * 建议卡**不调用模型、不按场景过滤**任何已有简历，两个按钮都只打开对应入口。
 */
import { Alert, Button, Space } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import GenerateResumeModal from "../../components/GenerateResumeModal";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  registerResumeCenterAiGenerateHandler,
  triggerResumeCenterAiGenerate,
} from "./resumeCenterAiBus";

export default function ResumeScenarioSuggestion() {
  useLocale();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    registerResumeCenterAiGenerateHandler(() => setOpen(true));
    return () => registerResumeCenterAiGenerateHandler(null);
  }, []);
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12 }}
        title={t("careerScenarios.center.suggestionTitle")}
        description={t("careerScenarios.center.suggestionBody")}
        action={
          <Space size={8}>
            <Button size="small" onClick={triggerResumeCenterAiGenerate}>
              {t("careerScenarios.center.suggestionGenerate")}
            </Button>
            <Button size="small" type="link" onClick={() => navigate("/jobs")}>
              {t("careerScenarios.center.suggestionJobs")}
            </Button>
          </Space>
        }
      />
      <GenerateResumeModal job={null} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
