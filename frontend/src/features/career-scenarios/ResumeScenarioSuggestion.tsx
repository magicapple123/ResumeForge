// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心筛选栏末尾的场景建议入口 + 通用简历生成弹窗（A2）。
 *
 * 形态（Q6）：筛选栏里一枚 28×28 的圆形提示图标，悬停/聚焦/点击才浮出说明与两个动作
 * ——此前是一整条蓝色 Alert 常驻在筛选栏下方，占掉一行高度、和列表抢视觉。
 *
 * 两个入口（筛选栏的「AI 生成」按钮、浮层里的「AI 生成通用简历」）共享同一个弹窗实例：
 * 弹窗状态与挂载都在这里，按钮经模块级登记表发"打开"信号（见 resumeCenterAiEntry.ts）。
 * 建议卡**不调用模型、不按场景过滤**任何已有简历，两个按钮都只打开对应入口。
 */
import { BulbOutlined } from "@ant-design/icons";
import { Button, Popover, Space } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import GenerateResumeModal from "../resume/generate/GenerateResumeModal";
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
      <Popover
        // 三种触发都留着：鼠标、键盘（focus）与触屏（click）各自都能打开。
        trigger={["hover", "focus", "click"]}
        mouseEnterDelay={0.1}
        mouseLeaveDelay={0.2}
        placement="bottomRight"
        content={
          // 宽度只锁在这里：正文一长就会把浮层撑成一条横带。
          <div style={{ maxWidth: 320 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {t("careerScenarios.center.suggestionTitle")}
            </div>
            <div style={{ marginBottom: 10 }}>{t("careerScenarios.center.suggestionBody")}</div>
            <Space size={8} wrap>
              <Button size="small" onClick={triggerResumeCenterAiGenerate}>
                {t("careerScenarios.center.suggestionGenerate")}
              </Button>
              <Button size="small" type="link" onClick={() => navigate("/jobs")}>
                {t("careerScenarios.center.suggestionJobs")}
              </Button>
            </Space>
          </div>
        }
      >
        <Button
          // F08：建议用「灯泡」，不是「感叹号」——后者读起来像"这里有个错误待处理"。
          type="text"
          shape="circle"
          icon={<BulbOutlined />}
          aria-label={t("careerScenarios.center.suggestionTitle")}
          className="resume-scenario-hint"
        />
      </Popover>
      <GenerateResumeModal job={null} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
