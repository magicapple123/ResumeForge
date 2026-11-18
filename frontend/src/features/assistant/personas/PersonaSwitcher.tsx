// SPDX-License-Identifier: Apache-2.0
/**
 * 视角切换（T26）：页头右上角的一个下拉，**不再是输入区上方的一排 Segmented**。
 *
 * 为什么搬进页头：视角是整段会话的属性（`chat_conversation.persona_id`），不是"这条
 * 消息带哪些技能"。放在正文首行会让它看起来像一个更大的技能开关，而且那一行是全页
 * 唯一的中性灰控件、比标题右缩 16px——视觉上比标题还抢戏。
 *
 * 形态要点（都是可观察的判据）：
 * - 触发按钮：`EyeOutlined` + 「视角 · {当前名}」+ ▾；
 * - 非默认视角：文字用品牌色 + 底色 `--rf-brand-wash`，一眼看出"开着视角"；
 * - 弹层：四项**各带一句说明**（`assistantBreadth.persona.desc.*`），当前项打勾，
 *   顶部复用 `persona.hint`；
 * - 草稿态（还没有会话）：禁用 + tooltip「发送第一条消息后才能切换视角」。
 *
 * 说明文字与后端 `Persona.summary` 是**两处各一份**：后端那份用于内置技能描述（数据），
 * 前端这份是界面文案（要走 i18n）。刻意不互相取——一个是数据、一个是翻译。
 */
import { CheckOutlined, EyeOutlined } from "@ant-design/icons";
import { Button, Popover, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useAssistantPersona } from "./useAssistantPersona";
import { PERSONA_IDS, type PersonaSelection } from "./personaApi";

const PERSONA_LABEL_KEYS: Record<string, MessageKey> = {
  hr_scan: "assistantBreadth.persona.hr_scan",
  interviewer: "assistantBreadth.persona.interviewer",
  headhunter: "assistantBreadth.persona.headhunter",
};

const PERSONA_DESC_KEYS: Record<string, MessageKey> = {
  "": "assistantBreadth.persona.desc.default",
  hr_scan: "assistantBreadth.persona.desc.hr_scan",
  interviewer: "assistantBreadth.persona.desc.interviewer",
  headhunter: "assistantBreadth.persona.desc.headhunter",
};

const OPTIONS: PersonaSelection[] = ["", ...PERSONA_IDS];

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
  const [open, setOpen] = useState(false);
  const disabled = conversationId === null || loading || saving;
  const name = t(personaId ? PERSONA_LABEL_KEYS[personaId] : "assistantBreadth.persona.default");
  const isDefault = personaId === "";

  const menu = (
    <div
      className="assistant-persona-menu"
      role="menu"
      aria-label={t("assistantBreadth.persona.aria")}
    >
      <Typography.Text type="secondary" className="assistant-persona-menu-hint">
        {t("assistantBreadth.persona.hint")}
      </Typography.Text>
      {OPTIONS.map((option) => {
        const active = option === personaId;
        return (
          <button
            key={option || "default"}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            className={`assistant-persona-option${active ? " is-active" : ""}`}
            onClick={() => {
              setOpen(false);
              if (!active) void setPersona(option);
            }}
          >
            <span className="assistant-persona-option-head">
              <span className="assistant-persona-option-name">
                {t(option ? PERSONA_LABEL_KEYS[option] : "assistantBreadth.persona.default")}
              </span>
              {active ? <CheckOutlined aria-hidden /> : null}
            </span>
            <span className="assistant-persona-option-desc">
              {t(PERSONA_DESC_KEYS[option] ?? "assistantBreadth.persona.desc.default")}
            </span>
          </button>
        );
      })}
    </div>
  );

  const trigger = (
    <Button
      type="text"
      size="small"
      icon={<EyeOutlined />}
      className={`assistant-persona-trigger${isDefault ? "" : " is-customized"}`}
      aria-label={`${t("assistantBreadth.persona.label")} · ${name}`}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
    >
      {t("assistantBreadth.persona.trigger", { name })}
      <span className="assistant-persona-caret" aria-hidden>
        ▾
      </span>
    </Button>
  );

  return (
    <>
      {disabled && conversationId === null ? (
        <Tooltip title={t("assistantBreadth.persona.needsConversation")}>{trigger}</Tooltip>
      ) : (
        <Popover
          content={menu}
          trigger="click"
          placement="bottomRight"
          open={open}
          onOpenChange={setOpen}
        >
          {trigger}
        </Popover>
      )}
      {failed ? (
        <Typography.Text type="danger" role="status" className="assistant-persona-failed">
          {t("assistantBreadth.persona.error")}
        </Typography.Text>
      ) : null}
    </>
  );
}
