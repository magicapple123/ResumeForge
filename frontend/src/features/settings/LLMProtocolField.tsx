// SPDX-License-Identifier: Apache-2.0
/** 接口协议字段（从 LLMRecordModal 抽出：换容器时按 500 行预算拆分，行为不变）。
 *
 * 三个选项：OpenAI 兼容（默认）/ Anthropic 原生 / OpenAI Responses（实验性）。
 * 额外职责（任务书 §4 T09 + D13/D14，2026-11 补 Anthropic 双向改写）：
 * - 用户**主动**切到 Responses 时，只有预设声明了 supports_responses 才改写 Base URL；
 *   普通服务商追加 /responses，智谱 / 星火换成预设给出的 responses_base_url；
 * - 用户**主动**切到 Anthropic 时，只有预设声明了 supports_anthropic 才改写：
 *   给了 anthropic_base_url 就用它（入口与 chat 不同址的厂商），否则追加 /messages；
 * - 切回 OpenAI 兼容时，只有"当前地址正是该预设的 Responses / Anthropic 专用地址"
 *   才还原成 chat 地址（沿用 normalizePresetBaseUrl 比较，尾斜杠与主机大小写不算差异）；
 * - 任何一次地址改写都给 toast（切过去与还原各用一条文案，见 i18n llmProtocol.toast.*）；
 * - 选中 Responses 时展示实验性提示条（多数已支持，Claude / Gemini / 硅基流动不支持）。
 */
import { Alert, App, Form, Select } from "antd";
import type { FormInstance } from "antd";
import type { RecordFormValues } from "./useLLMRecordTools";
import type { LLMApiStyle } from "../../types";
import type { MessageKey } from "../../i18n";
import {
  LLM_PRESETS,
  presetAnthropicBaseUrl,
  presetChatBaseUrl,
  presetResponsesBaseUrl,
} from "../../config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { normalizePresetBaseUrl } from "./SettingsConfig";

interface Props {
  form: FormInstance<RecordFormValues>;
}

export default function LLMProtocolField({ form }: Props) {
  // 本组件用模块级 t()：订阅语言变化，切语言后提示文案要跟着变。
  useLocale();
  const { message } = App.useApp();
  const apiStyle = Form.useWatch<LLMApiStyle>("api_style", form);

  /** 协议切换时按预设声明改写地址（见组件头注释的五条边界）。 */
  const handleChange = (nextStyle: LLMApiStyle) => {
    const provider = String(form.getFieldValue("provider") ?? "");
    const preset = LLM_PRESETS.find((item) => item.provider === provider);
    if (!preset) return;
    const current = String(form.getFieldValue("base_url") ?? "").trim();

    /**
     * 把地址改成 `target`（null = 该预设没声明这条路，一个字都不动）。
     *
     * 已经等于目标地址时不写表单、也不提示：用户切协议但地址本来就对，弹一句
     * "已切换地址"只会让他怀疑自己点错了什么。
     */
    const rewrite = (target: string | null, toastKey: MessageKey) => {
      if (!target) return;
      if (normalizePresetBaseUrl(current) === normalizePresetBaseUrl(target)) return;
      form.setFieldsValue({ base_url: target });
      message.success(t(toastKey));
    };

    if (nextStyle === "responses") {
      rewrite(presetResponsesBaseUrl(preset), "llmProtocol.toast.baseUrlSwitched");
      return;
    }
    if (nextStyle === "anthropic") {
      rewrite(presetAnthropicBaseUrl(preset), "llmProtocol.toast.anthropicBaseUrlSwitched");
      return;
    }
    // 切回 OpenAI 兼容：只有"当前地址正是某条专用地址"才还原，用户自填的地址不动。
    const dedicated = [presetResponsesBaseUrl(preset), presetAnthropicBaseUrl(preset)].filter(
      (url): url is string => Boolean(url),
    );
    const onDedicatedAddress = dedicated.some(
      (url) => normalizePresetBaseUrl(current) === normalizePresetBaseUrl(url),
    );
    if (!onDedicatedAddress) return;
    rewrite(presetChatBaseUrl(preset), "llmProtocol.toast.chatBaseUrlRestored");
  };

  return (
    <>
      <Form.Item
        name="api_style"
        label={t("llmRecord.field.protocol")}
        // 原有说明保留，下面追加两行：Responses 的支持面（多数已支持、三家不支持）
        // 与 Anthropic 新代际的思考形态变化（T10）。
        tooltip={
          <span>
            {t("llmRecord.hint.protocol")}
            <br />
            {t("llmProtocol.hint.protocolExtra")}
            <br />
            {t("llmProtocol.hint.anthropicAdaptive")}
          </span>
        }
      >
        <Select
          options={[
            { value: "openai", label: t("llmRecord.protocol.openai") },
            { value: "anthropic", label: t("llmRecord.protocol.anthropic") },
            // 实验性第三项：默认值仍是 openai（D13），只有用户主动选中才走 Responses。
            { value: "responses", label: t("llmProtocol.protocol.responses") },
          ]}
          onChange={handleChange}
        />
      </Form.Item>
      {apiStyle === "responses" && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
          title={t("llmProtocol.alert.responsesTitle")}
          description={t("llmProtocol.alert.responsesDescription")}
        />
      )}
    </>
  );
}
