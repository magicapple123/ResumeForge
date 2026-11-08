// SPDX-License-Identifier: Apache-2.0
/**
 * 右侧「模型 · 推理等级」合并 chip（R06-B）。
 *
 * 改之前这里是两处互不相识的控件：左边「思考强度 ⓘ 默认 ▾」（文字标签 + 问号 + 下拉 +
 * 自定义输入框四件套），右边一枚只读模型名。同一件事（用哪个模型、想多深）被拆成左右两半。
 * 现在合成一枚可点 chip：文案 `{模型} · {推理等级}`，点开两行面板。
 *
 * 三条硬约束：
 * 1. **模型行不可点**：`disabled: true` 且**不给 `children`**——给了就会出现箭头，暗示可点。
 * 2. **提示挂在行内文字上**：disabled 的菜单项挂不住 `Tooltip`（事件被吞），所以
 *    `<Tooltip><span>…</span></Tooltip>` 包住那一行的值文本。
 * 3. **只订阅一次**：模型名与记录名的取数（`getLLMConfig` + `subscribeLLMConfig`）是从
 *    原 `ModelChip` **整块搬**过来的，不要再拉第二份——两份缓存迟早不一致。
 */

import { useEffect, useState } from "react";
import { CheckOutlined, DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { getLLMConfig, listLLMConfigRecords } from "../../../../api/settings";
import { layer } from "../../../../theme/tokens";
import { t } from "../../../../i18n";
import { REASONING_EFFORT_LABEL_KEYS } from "../../../../i18n/enum/assistant";
import { useLocale } from "../../../../i18n/i18nContext";
import { llmRecordDisplayName } from "../../../../utils/displayNames";
import {
  MAX_REASONING_EFFORT_CHARS,
  REASONING_EFFORT_OPTIONS,
  isValidReasoningEffort,
  type ReasoningEffort,
} from "../../../../types/assistant";
import { subscribeLLMConfig } from "../../../settings/llmConfigEvents";
import type { LLMConfig, LLMConfigRecord } from "../../../../types";

/** 二级菜单里「档位」项的 key 前缀：空串档位也要有个非空 key，否则 rc-menu 认不出来。 */
const EFFORT_KEY_PREFIX = "effort:";
/** 「自定义…」项的 key（不是档位值，只是让输入框冒出来）。 */
const CUSTOM_KEY = "custom";

/**
 * 档位显示名：预设档位走语言包，自定义档位**原值上屏**（各家词汇不同，不猜中文）。
 *
 * 空串 = 不发送该参数、沿用服务商默认，语言包里叫「默认」。
 */
function effortLabel(effort: ReasoningEffort): string {
  const key = REASONING_EFFORT_LABEL_KEYS[effort];
  if (key) return t(key);
  return effort.trim() ? effort : t("enumsAssistant.reasoningEffort.default");
}

export interface ReasoningChipProps {
  /** 浮窗形态：弹层要抬到卡片之上，否则被卡片盖住。 */
  compact: boolean;
  /** 生成中：整枚 chip 与自定义输入框都不可改。 */
  sending: boolean;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
}

export default function ReasoningChip({
  compact,
  sending,
  reasoningEffort,
  onReasoningEffortChange,
}: ReasoningChipProps) {
  useLocale();
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [records, setRecords] = useState<LLMConfigRecord[]>([]);
  const [open, setOpen] = useState(false);
  /**
   * 自定义档位的**界面态**：选「自定义…」后 chip 原地变成输入框。
   *
   * 不按"值是否在预设里"反推——那样回车/失焦后输入框会一直留着。这里由用户动作驱动：
   * 选「自定义…」置真，回车/失焦置假，值本身仍由父组件受控。
   */
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([getLLMConfig(), listLLMConfigRecords()])
        .then(([next, list]) => {
          if (cancelled) return;
          setConfig(next);
          setRecords(list);
        })
        .catch(() => {
          // 读不到就不显示（老后端/文件损坏），不打扰其它功能。
          if (cancelled) return;
          setConfig(null);
          setRecords([]);
        });
    };
    load();
    const unsubscribe = subscribeLLMConfig(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /** 一条记录都没有时不渲染：给一个"看起来能点"的假下拉只会让人以为是坏了。 */
  if (!config?.model) return null;
  const record =
    records.find((item) => item.id === config.record_id) ??
    records.find((item) => item.is_active) ??
    null;
  if (!record) return null;

  const recordName = llmRecordDisplayName(record);
  const currentLabel = effortLabel(reasoningEffort);

  /** 回车 / 失焦：回到 chip 形态；值被清空时退回「默认」，不留一个空输入框。 */
  const finishCustom = (value: string) => {
    setCustomizing(false);
    if (!value.trim()) onReasoningEffortChange("");
  };

  const menuItems: MenuProps["items"] = [
    {
      key: "model",
      // 不可点、且**没有 children**：没有箭头才不会暗示"点进去还能选"。
      disabled: true,
      label: (
        <span className="assistant-reasoning-chip-row">
          <span className="assistant-reasoning-chip-row-label">{t("reasoningChip.row.model")}</span>
          <Tooltip title={t("assistantComposer.modelChip.hoverHint")} placement="left">
            <span className="assistant-reasoning-chip-row-value">
              {recordName ? `${recordName} · ${record.model}` : record.model}
            </span>
          </Tooltip>
        </span>
      ),
    },
    {
      key: "effort",
      label: (
        <span className="assistant-reasoning-chip-row">
          <span className="assistant-reasoning-chip-row-label">
            {t("reasoningChip.row.effort")}
          </span>
          <span className="assistant-reasoning-chip-row-value">{currentLabel}</span>
        </span>
      ),
      children: [
        ...REASONING_EFFORT_OPTIONS.map((option) => ({
          key: `${EFFORT_KEY_PREFIX}${option.value}`,
          label: effortLabel(option.value),
          // 当前档位打勾：二级菜单不参与 antd 的选中态（Dropdown 内部 selectable=false）。
          icon: option.value === reasoningEffort ? <CheckOutlined /> : undefined,
        })),
        { type: "divider" as const },
        {
          key: CUSTOM_KEY,
          label: t("assistantComposer.effort.custom"),
        },
      ],
    },
  ];

  const handleMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === CUSTOM_KEY) {
      setCustomizing(true);
      // 自定义档位从空开始填：留着上一个预设值会让"自定义"看起来没生效。
      onReasoningEffortChange("");
      return;
    }
    if (key.startsWith(EFFORT_KEY_PREFIX)) {
      setCustomizing(false);
      onReasoningEffortChange(key.slice(EFFORT_KEY_PREFIX.length));
    }
  };

  /** 自定义档位：chip 原地变小输入框（沿用原有的格式校验与失焦退回逻辑）。 */
  if (customizing) {
    return (
      <span className="assistant-reasoning-chip-editing">
        <Input
          size="small"
          className="assistant-reasoning-input"
          value={reasoningEffort}
          maxLength={MAX_REASONING_EFFORT_CHARS}
          placeholder={t("assistantComposer.placeholder.customEffort")}
          disabled={sending}
          status={isValidReasoningEffort(reasoningEffort) ? undefined : "error"}
          aria-label={t("assistantComposer.aria.customEffort")}
          autoFocus
          onChange={(event) => onReasoningEffortChange(event.target.value)}
          onPressEnter={(event) => finishCustom(event.currentTarget.value)}
          onBlur={(event) => finishCustom(event.target.value)}
        />
      </span>
    );
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      placement="topRight"
      disabled={sending}
      styles={compact ? { root: { zIndex: layer.cardPopup } } : undefined}
      menu={{ items: menuItems, onClick: handleMenuClick }}
    >
      <Button
        type="text"
        size="small"
        className="assistant-model-chip assistant-reasoning-chip"
        aria-label={t("reasoningChip.aria", { model: record.model, effort: currentLabel })}
      >
        <span className="assistant-reasoning-chip-model">{record.model}</span>
        <span className="assistant-reasoning-chip-sep" aria-hidden="true">
          ·
        </span>
        <span className="assistant-reasoning-chip-effort">{currentLabel}</span>
        <DownOutlined className="assistant-reasoning-chip-caret" aria-hidden="true" />
      </Button>
    </Dropdown>
  );
}
