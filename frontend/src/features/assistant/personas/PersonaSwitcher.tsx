// SPDX-License-Identifier: Apache-2.0
/**
 * 视角切换器（18C）：通用 / HR 六秒扫描 / 面试官追问 / 猎头判断。
 *
 * 只换系统提示与输出结构，工具集不变（见 assistant_personas 模块注释）。
 * 草稿态（还没有会话）时禁用：视角要挂到某个会话上才会生效。
 */
import { Segmented, Tooltip, Typography } from "antd";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useAssistantPersona } from "./useAssistantPersona";
import { PERSONA_IDS, type PersonaSelection } from "./personaApi";

const PERSONA_LABEL_KEYS: Record<string, MessageKey> = {
  hr_scan: "assistantBreadth.persona.hr_scan",
  interviewer: "assistantBreadth.persona.interviewer",
  headhunter: "assistantBreadth.persona.headhunter",
};

const OPTIONS: Array<{ value: PersonaSelection; labelKey: MessageKey }> = [
  { value: "", labelKey: "assistantBreadth.persona.default" },
  ...PERSONA_IDS.map((id) => ({ value: id as PersonaSelection, labelKey: PERSONA_LABEL_KEYS[id] })),
];

interface Props {
  conversationId: number | null;
  onChanged?: () => void;
}

export default function PersonaSwitcher({ conversationId, onChanged }: Props) {
  useLocale();
  const { personaId, loading, saving, failed, setPersona } = useAssistantPersona(
    conversationId,
    onChanged,
  );
  const disabled = conversationId === null || loading || saving;
  const hint =
    conversationId === null
      ? t("assistantBreadth.persona.needsConversation")
      : failed
        ? t("assistantBreadth.persona.error")
        : t("assistantBreadth.persona.hint");

  return (
    <div className="assistant-persona" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Tooltip title={hint}>
        <Typography.Text type="secondary">{t("assistantBreadth.persona.label")}</Typography.Text>
      </Tooltip>
      <Segmented<PersonaSelection>
        aria-label={t("assistantBreadth.persona.aria")}
        disabled={disabled}
        value={personaId}
        onChange={(next) => void setPersona(next)}
        options={OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
      />
      {failed ? (
        <Typography.Text type="danger" role="status">
          {hint}
        </Typography.Text>
      ) : null}
    </div>
  );
}
