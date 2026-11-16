// SPDX-License-Identifier: Apache-2.0
/**
 * 「恢复默认」按钮（I-10）：字段级（`keys`）与卡片级（`scope`）共用一颗。
 *
 * 三条约束：
 * 1. **必须二次确认**：恢复默认会丢掉用户手调的值，`Popconfirm` 是这一层的唯一闸门；
 * 2. 没有可重置项时**不渲染**（而不是渲染一个点了没反应的灰按钮）；
 * 3. 成功后广播一次 `settings:reset` 事件：卡片自己监听并重新取数，避免每个调用点
 *    都写一遍"重置完刷新谁"。
 */
import { App, Button, Popconfirm, Tooltip } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { resetDoneMessage, useSettingsReset } from "./useSettingsReset";

/** 重置成功后广播的事件名（卡片按需监听）。 */
export const SETTINGS_RESET_EVENT = "resume-forge:settings-reset";

interface Props {
  /** 卡片级：要恢复的作用域名（如 `model` / `asr`）。 */
  scope?: string;
  /** 字段级：只恢复这几个键。 */
  keys?: string[];
  /** 显示成图标按钮（卡片标题栏）还是带文字的小按钮。 */
  compact?: boolean;
  disabled?: boolean;
  /** 额外说明，出现在确认框里（告诉用户这次会丢什么）。 */
  detail?: string;
}

export default function SettingsResetButton({
  scope,
  keys,
  compact = true,
  disabled = false,
  detail,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const api = useSettingsReset();

  // 字段级：键都在 targets 里才算可重置；卡片级：该作用域下至少有一项可重置。
  const available = keys
    ? keys.some((key) => api.targets.some((item) => item.key === key))
    : scope
      ? api.targets.some((item) => item.scope === scope)
      : api.targets.length > 0;
  if (api.loading || !available) return null;
  const changed = scope ? api.customizedCount(scope) : 0;

  const run = async () => {
    const result = scope ? await api.resetScope(scope) : keys ? await api.resetKeys(keys) : null;
    if (!result) {
      message.error(t("settingsReset.failed"));
      return;
    }
    message.success(resetDoneMessage(result));
    window.dispatchEvent(new CustomEvent(SETTINGS_RESET_EVENT, { detail: result }));
  };

  const label = t("settingsReset.action");
  const title =
    changed > 0
      ? t("settingsReset.confirm.withCount", { count: changed })
      : t("settingsReset.confirm");

  return (
    <Popconfirm
      title={label}
      description={
        <span style={{ display: "block", maxWidth: 260 }}>
          {title}
          {detail ? ` ${detail}` : ""}
        </span>
      }
      okText={t("settingsReset.confirm.ok")}
      cancelText={t("common.action.cancel")}
      onConfirm={() => void run()}
      disabled={disabled}
    >
      {compact ? (
        <Tooltip title={label}>
          <Button
            size="small"
            type="text"
            aria-label={label}
            disabled={disabled}
            icon={<UndoOutlined />}
          />
        </Tooltip>
      ) : (
        <Button size="small" disabled={disabled} icon={<UndoOutlined />}>
          {label}
        </Button>
      )}
    </Popconfirm>
  );
}
