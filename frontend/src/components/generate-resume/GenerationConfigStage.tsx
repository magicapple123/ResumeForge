/** 生成配置阶段：模型状态提示 + 简历名称 + 美化档位 + 篇幅版式 + 补充要求。
 *
 * 纯展示受控组件——全部配置状态与开始动作由 GenerateResumeModal 持有，经 props 回传；
 * 零 api 导入。
 */
import {
  Alert,
  Button,
  Input,
  Segmented,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import type { EnhancementLevel, Job, ResumeLayout } from "../../types";
import { RESUME_ENHANCEMENT_LEVELS, enhancementLevelDescription } from "../../config";
import ResumeLayoutControls from "../ResumeLayoutControls";

/** 自定义提示词上限，与后端 GenerateOptions.custom_instruction 一致。 */
export const MAX_CUSTOM_INSTRUCTION = 2000;

interface Props {
  job: Job | null;
  title: string;
  setTitle: (value: string) => void;
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
  return (
    <div>
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
              : "通用简历不针对任何岗位：系统会完整使用你的资料（只受篇幅预算限制），保留各方向的经历与技能；原始资料不会被修改。"
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
              <Tooltip title={enhancementLevelDescription(item.value, !job)}>
                {item.label}
              </Tooltip>
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
      <ResumeLayoutControls layout={layout} disabled={!llmReady} onChange={setLayout} />
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        默认 1 页 A4 +
        标准字号。生成后如果内容塞不下，可以在预览里一键增加页数或缩小字号，不必重新生成。
      </Typography.Text>

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        补充要求（选填）
      </Typography.Title>
      <Input.TextArea
        value={customInstruction}
        maxLength={MAX_CUSTOM_INSTRUCTION}
        showCount
        disabled={!llmReady}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder="例如：突出后端性能优化经历；不要出现「负责…」这类空泛表述；把实习经历放在教育经历前面。"
        onChange={(event) => setCustomInstruction(event.target.value)}
      />
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
