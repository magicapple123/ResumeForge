// SPDX-License-Identifier: Apache-2.0
/** 生成配置阶段：模型状态提示 + 简历名称 + 文档模式 + 美化档位 + 篇幅版式 + 职业场景 + 补充要求。
 *
 * 纯展示受控组件——全部配置状态与开始动作由 GenerateResumeModal 持有，经 props 回传；
 * 零 api 导入（职业场景区块自己加载目录，失败只降级不阻断）。
 */
import { Alert, Button, Input, Segmented, Space, Switch, Tooltip, Typography } from "antd";
import type { EnhancementLevel, Job, ResumeLayout } from "../../types";
import { RESUME_ENHANCEMENT_LEVELS, enhancementLevelDescription } from "../../config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  pageLimitOnModeSwitch,
  pageLimitOptions,
} from "../../features/resume-research/documentMode";
import GenerationScenarioControl from "../../features/career-scenarios/GenerationScenarioControl";
import GenerationGroupSummary from "./GenerationGroupSummary";
import type {
  GenerationExtras,
  GenerationDocumentMode,
} from "../../features/career-scenarios/useGenerationExtras";
import { MaxLengthHint } from "../common/MaxLengthHint";
import ResumeLayoutControls from "../ResumeLayoutControls";

/** 自定义提示词上限，与后端 GenerateOptions.custom_instruction 一致。 */
export const MAX_CUSTOM_INSTRUCTION = 2000;

interface Props {
  job: Job | null;
  title: string;
  setTitle: (value: string) => void;
  /** 本次生成专属上下文（契约 §5 文档模式 + §2.5 职业场景）：默认都不发送。 */
  generation: GenerationExtras;
  enhance: boolean;
  setEnhance: (value: boolean) => void;
  enhancementLevel: EnhancementLevel;
  setEnhancementLevel: (value: EnhancementLevel) => void;
  layout: ResumeLayout;
  setLayout: (next: ResumeLayout) => void;
  customInstruction: string;
  setCustomInstruction: (value: string) => void;
  llmReady: boolean;
  modelName: string;
  onClose: () => void;
  onStart: () => void;
}

export default function GenerationConfigStage({
  job,
  title,
  setTitle,
  generation,
  enhance,
  setEnhance,
  enhancementLevel,
  setEnhancementLevel,
  layout,
  setLayout,
  customInstruction,
  setCustomInstruction,
  llmReady,
  modelName,
  onClose,
  onStart,
}: Props) {
  useLocale();
  /** 切换文档模式：只夹紧页数（不转换内容、不改模板），切回普通简历时 >3 页会被夹到 3。 */
  const changeDocumentMode = (next: GenerationDocumentMode) => {
    generation.setDocumentMode(next);
    const current = typeof layout.page_limit === "number" ? layout.page_limit : 1;
    const { pageLimit } = pageLimitOnModeSwitch(current, next);
    if (pageLimit !== current) setLayout({ ...layout, page_limit: pageLimit });
  };

  return (
    <div>
      {/* F4：生成只用当前方案（无选组器）；摘要只读，失败不阻断生成。 */}
      <GenerationGroupSummary />
      {!llmReady ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("generate.config.llmMissing")}
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("generate.config.model-hint", {
            model: modelName || t("generate.config.model-unknown"),
          })}
          description={job ? t("generate.config.jobHint") : t("generate.config.generalHint")}
        />
      )}
      {!job && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong>{t("generate.config.titleName")}</Typography.Text>
          <Input
            aria-label={t("generate.config.titleName")}
            value={title}
            maxLength={64}
            style={{ marginTop: 8 }}
            placeholder={t("generate.config.titlePlaceholder")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      )}
      <Typography.Title level={5}>
        {job ? t("generate.config.headingJob") : t("generate.config.headingGeneral")}
      </Typography.Title>
      <Space orientation="vertical" size={14} style={{ width: "100%" }}>
        <Space size={10}>
          <Switch checked={enhance} onChange={setEnhance} />
          <Typography.Text strong>
            {job ? t("generate.config.enhanceJob") : t("generate.config.enhanceGeneral")}
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary">
          {job ? t("generate.config.enhanceJobHint") : t("generate.config.enhanceGeneralHint")}
        </Typography.Text>
        <Segmented
          block
          disabled={!enhance}
          value={enhancementLevel}
          // 下面的说明只讲当前选中的那一档，得先点一下才知道别的档是什么；
          // 每一档自己带上悬停说明，生成前可以先把三档比一遍。
          options={RESUME_ENHANCEMENT_LEVELS.map((item) => ({
            label: (
              <Tooltip title={enhancementLevelDescription(item.value, !job)}>{item.label}</Tooltip>
            ),
            value: item.value,
          }))}
          onChange={(value) => setEnhancementLevel(value as EnhancementLevel)}
        />
        <Typography.Text type={enhance ? undefined : "secondary"}>
          {enhance
            ? enhancementLevelDescription(enhancementLevel, !job)
            : t("generate.config.enhanceOffHint")}
        </Typography.Text>
      </Space>

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        {t("generate.config.layoutSection")}
      </Typography.Title>
      <Space size={10} align="center" style={{ marginBottom: 10 }} wrap>
        <Typography.Text type="secondary">{t("research.mode.label")}</Typography.Text>
        <Segmented
          size="small"
          aria-label={t("research.mode.label")}
          value={generation.documentMode}
          onChange={(value) => changeDocumentMode(value as GenerationDocumentMode)}
          options={[
            { value: "resume", label: t("research.mode.resume") },
            { value: "long_cv", label: t("research.mode.longCv") },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {generation.documentMode === "long_cv"
            ? t("research.mode.budget")
            : t("careerScenarios.generate.documentModeNote")}
        </Typography.Text>
      </Space>
      <ResumeLayoutControls
        layout={layout}
        disabled={!llmReady}
        onChange={setLayout}
        // 生成场景：默认板块顺序跟随「我的资料」里排好的顺序。预览 / 编辑已保存简历
        // 时不传（它们读这份简历自己的 section_order，老简历外观因此不被追溯改变）。
        preferProfileOrder
        // 长 CV 时页数上限放宽到 10（后端按 MODE_PAGE_LIMITS 再校验一次）。
        pageLimitOptions={
          generation.documentMode === "long_cv" ? pageLimitOptions("long_cv") : undefined
        }
      />
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        {t("generate.config.layoutHint")}
      </Typography.Text>

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        {t("careerScenarios.generate.title")}
      </Typography.Title>
      <GenerationScenarioControl
        value={generation.careerContext}
        onChange={generation.setCareerContext}
        disabled={!llmReady}
      />

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        {t("generate.config.extraRequirements")}
      </Typography.Title>
      <Input.TextArea
        value={customInstruction}
        maxLength={MAX_CUSTOM_INSTRUCTION}
        disabled={!llmReady}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={t("generate.config.extraPlaceholder")}
        onChange={(event) => setCustomInstruction(event.target.value)}
      />
      <MaxLengthHint value={customInstruction} maxLength={MAX_CUSTOM_INSTRUCTION} />
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        {t("generate.config.extraHint")}
      </Typography.Text>

      <div style={{ marginTop: 24, textAlign: "right" }}>
        <Space>
          <Button onClick={onClose}>{t("common.action.cancel")}</Button>
          <Button type="primary" disabled={!llmReady} onClick={onStart}>
            {t("generate.config.start")}
          </Button>
        </Space>
      </div>
    </div>
  );
}
