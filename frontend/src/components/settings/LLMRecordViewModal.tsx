// SPDX-License-Identifier: Apache-2.0
/** 配置记录的只读详情弹窗：点记录卡本体查看。密钥只显示脱敏占位，不回显本体。 */
import { Descriptions, Modal, Tag } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { LLMConfigRecord } from "../../types";
import { API_KEY_MASK, CUSTOM_PRESET_LABEL_KEY, matchingPreset } from "./SettingsConfig";
import { llmRecordDisplayName } from "../../utils/displayNames";

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
  if (record.stop && record.stop.length > 0)
    lines.push(
      `${t("llmRecordView.advanced.stop")} = ${record.stop.join(t("llmRecordView.separator.stop"))}`,
    );
  if (record.extra_body && Object.keys(record.extra_body).length > 0)
    lines.push(`extra_body = ${JSON.stringify(record.extra_body)}`);
  return lines;
}

export default function LLMRecordViewModal({ open, record, onClose }: Props) {
  // 本组件用模块级 t()：不订阅语言变化的话，切到英文后这一屏不会重渲染。
  useLocale();
  if (!record) return null;
  const advanced = advancedLines(record);
  // Base URL / API Key 是纯 ASCII 技术标签（源文本身就是英文），收进词表会触发
  // messageContract 的 source-ascii-english 校验，所以这两处保留字面量。
  return (
    <Modal
      title={t("llmRecordView.title.detail", { name: llmRecordDisplayName(record) })}
      open={open}
      onCancel={onClose}
      // 只读详情没有第二个动作，底部栏那只「关闭」是右上角 × 的重复入口（Esc / 点遮罩
      // 同样关闭），所以不渲染 footer。
      footer={null}
      width={560}
    >
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label={t("llmRecordView.field.preset")}>
          {t(matchingPreset(record)?.labelKey ?? CUSTOM_PRESET_LABEL_KEY)}
        </Descriptions.Item>
        <Descriptions.Item label={t("llmRecordView.field.protocol")}>
          {record.api_style === "anthropic"
            ? t("llmRecordView.protocol.anthropic")
            : t("llmRecordView.protocol.openai")}
        </Descriptions.Item>
        <Descriptions.Item label="Base URL">
          {record.base_url || t("llmRecordView.value.empty")}
        </Descriptions.Item>
        <Descriptions.Item label={t("llmRecordView.field.model")}>
          {record.model || t("llmRecordView.value.empty")}
        </Descriptions.Item>
        <Descriptions.Item label="API Key">
          {record.api_key ? (
            // 脱敏承诺：密钥本体与 `********:record:N` 引用都不出弹窗，只说明"已配置"。
            <Tag color="green">{t("llmRecordView.apiKey.configured", { mask: API_KEY_MASK })}</Tag>
          ) : (
            <Tag>{t("llmRecordView.apiKey.notConfigured")}</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t("llmRecordView.field.temperature")}>
          {record.temperature}
        </Descriptions.Item>
        <Descriptions.Item label={t("llmRecordView.field.timeout")}>
          {t("llmRecordView.value.timeoutSeconds", { seconds: record.timeout_seconds })}
        </Descriptions.Item>
        <Descriptions.Item label={t("llmRecordView.field.maxTokens")}>
          {record.max_tokens === 0 ? t("llmRecordView.maxTokens.unlimited") : record.max_tokens}
        </Descriptions.Item>
        <Descriptions.Item label={t("llmRecordView.field.thinking")}>
          {record.thinking_enabled
            ? record.thinking_effort
              ? t("llmRecordView.thinking.onWithEffort", { effort: record.thinking_effort })
              : t("llmRecordView.thinking.onPreset")
            : t("llmRecordView.thinking.off")}
        </Descriptions.Item>
        {advanced.length > 0 && (
          <Descriptions.Item label={t("llmRecordView.field.advanced")}>
            {advanced.join(t("llmRecordView.separator.line"))}
          </Descriptions.Item>
        )}
      </Descriptions>
    </Modal>
  );
}
