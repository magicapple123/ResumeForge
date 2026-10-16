/** 配置记录的只读详情弹窗：点记录卡本体查看。密钥只显示脱敏占位，不回显本体。 */
import { Descriptions, Modal, Button, Tag } from "antd";
import type { LLMConfigRecord } from "../../types";
import { API_KEY_MASK, CUSTOM_PRESET_LABEL, matchingPreset } from "./SettingsConfig";

interface Props {
  open: boolean;
  record: LLMConfigRecord | null;
  onClose: () => void;
}

/** 有值才算"配置过"的高级参数行：全部为空时不渲染这一节，避免整屏 null。 */
function advancedLines(record: LLMConfigRecord): string[] {
  const lines: string[] = [];
  if (record.top_p !== null && record.top_p !== undefined) lines.push(`top_p = ${record.top_p}`);
  if (record.top_k !== null && record.top_k !== undefined) lines.push(`top_k = ${record.top_k}`);
  if (record.frequency_penalty !== null && record.frequency_penalty !== undefined)
    lines.push(`frequency_penalty = ${record.frequency_penalty}`);
  if (record.presence_penalty !== null && record.presence_penalty !== undefined)
    lines.push(`presence_penalty = ${record.presence_penalty}`);
  if (record.seed !== null && record.seed !== undefined) lines.push(`seed = ${record.seed}`);
  if (record.repetition_penalty !== null && record.repetition_penalty !== undefined)
    lines.push(`repetition_penalty = ${record.repetition_penalty}`);
  if (record.stop && record.stop.length > 0) lines.push(`停止词 = ${record.stop.join("、")}`);
  if (record.extra_body && Object.keys(record.extra_body).length > 0)
    lines.push(`extra_body = ${JSON.stringify(record.extra_body)}`);
  return lines;
}

export default function LLMRecordViewModal({ open, record, onClose }: Props) {
  if (!record) return null;
  const advanced = advancedLines(record);
  return (
    <Modal
      title={`配置详情「${record.name}」`}
      open={open}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          关闭
        </Button>
      }
      width={560}
    >
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="预设">
          {matchingPreset(record)?.label ?? CUSTOM_PRESET_LABEL}
        </Descriptions.Item>
        <Descriptions.Item label="接口协议">
          {record.api_style === "anthropic"
            ? "Anthropic 原生（Messages）"
            : "OpenAI 兼容（Chat Completions）"}
        </Descriptions.Item>
        <Descriptions.Item label="Base URL">{record.base_url || "未填写"}</Descriptions.Item>
        <Descriptions.Item label="模型名称">{record.model || "未填写"}</Descriptions.Item>
        <Descriptions.Item label="API Key">
          {record.api_key ? (
            // 脱敏承诺：密钥本体与 `********:record:N` 引用都不出弹窗，只说明"已配置"。
            <Tag color="green">已配置（{API_KEY_MASK}）</Tag>
          ) : (
            <Tag>未配置</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="创意度 temperature">{record.temperature}</Descriptions.Item>
        <Descriptions.Item label="超时时间">{record.timeout_seconds} 秒</Descriptions.Item>
        <Descriptions.Item label="最大输出 Token">
          {record.max_tokens === 0 ? "不限制（由服务商决定上限）" : record.max_tokens}
        </Descriptions.Item>
        <Descriptions.Item label="思考模式">
          {record.thinking_enabled
            ? `已开启${record.thinking_effort ? ` · 档位 ${record.thinking_effort}` : " · 不指定档位"}`
            : "关闭"}
        </Descriptions.Item>
        {advanced.length > 0 && (
          <Descriptions.Item label="高级调整">{advanced.join("；")}</Descriptions.Item>
        )}
      </Descriptions>
    </Modal>
  );
}
