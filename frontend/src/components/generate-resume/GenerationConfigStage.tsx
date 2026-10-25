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
  /** 切换文档模式：只夹紧页数（不转换内容、不改模板），切回普通简历时 >3 页会被夹到 3。 */
  const changeDocumentMode = (next: GenerationDocumentMode) => {
    generation.setDocumentMode(next);
    const current = typeof layout.page_limit === "number" ? layout.page_limit : 1;
    const { pageLimit } = pageLimitOnModeSwitch(current, next);
    if (pageLimit !== current) setLayout({ ...layout, page_limit: pageLimit });
  };

  return (
    <div>
      {/* F4：生成只用当前组（无选组器）；摘要只读，失败不阻断生成。 */}
      <GenerationGroupSummary />
      {!llmReady ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="尚未配置大模型 API，请先到「设置」页完成配置（支持 DeepSeek / 豆包 / Kimi / OpenAI 等）"
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={`当前模型：${modelName || "未知"}。生成过程约需 1-2 分钟，生成在后台进行，期间可关闭弹窗，完成后会自动提醒。`}
          description={
            job
              ? "系统会根据目标岗位的 JD，从完整个人资料与经历总结文件中筛选并排序相关信息；原始资料不会被修改。"
              : "通用简历不针对任何岗位：系统会使用当前组参与的大字段（只受篇幅预算限制），保留各方向的经历与技能；原始资料不会被修改。"
          }
        />
      )}
      {!job && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong>简历名称</Typography.Text>
          <Input
            aria-label="简历名称"
            value={title}
            maxLength={64}
            style={{ marginTop: 8 }}
            placeholder="留空则自动命名为「姓名-通用简历-时间」"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      )}
      <Typography.Title level={5}>{job ? "岗位适配与内容美化" : "内容美化"}</Typography.Title>
      <Space orientation="vertical" size={14} style={{ width: "100%" }}>
        <Space size={10}>
          <Switch checked={enhance} onChange={setEnhance} />
          <Typography.Text strong>
            {job ? "根据岗位要求美化拓展经历" : "用资料里的总结文件补足经历细节"}
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary">
          {job
            ? "基于已有经历和总结文件补足表达细节，突出与岗位相关的能力，不修改个人资料原文。"
            : "基于已有经历和总结文件补足表达细节，突出资料本身的重点，不修改个人资料原文。"}
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
            : "关闭后仅筛选和整理原有资料，不进行拓展。"}
        </Typography.Text>
      </Space>

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        篇幅与版式
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
        默认 1 页 A4 +
        标准字号。生成后如果内容塞不下，可以在预览里一键增加页数或缩小字号，不必重新生成。
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
        补充要求（选填）
      </Typography.Title>
      <Input.TextArea
        value={customInstruction}
        maxLength={MAX_CUSTOM_INSTRUCTION}
        disabled={!llmReady}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder="例如：突出后端性能优化经历；不要出现「负责…」这类空泛表述；把实习经历放在教育经历前面。"
        onChange={(event) => setCustomInstruction(event.target.value)}
      />
      <MaxLengthHint value={customInstruction} maxLength={MAX_CUSTOM_INSTRUCTION} />
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        这段要求会附在生成提示词后面，只影响表达方向；事实锚定、篇幅上限和防虚构规则不变。
      </Typography.Text>

      <div style={{ marginTop: 24, textAlign: "right" }}>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={!llmReady} onClick={onStart}>
            开始生成
          </Button>
        </Space>
      </div>
    </div>
  );
}
