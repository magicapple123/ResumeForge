// SPDX-License-Identifier: Apache-2.0
/**
 * 「助手记忆」卡顶部的两个开关（T23）：自动整理对话记忆 / 记忆注入。
 *
 * 为什么单列组件：卡片本身已有列表、筛选、清空与弹层编排，两个开关各有标题与一句
 * 说明，混在列表逻辑里读不出"这里有两件独立的事"。开关不再显示「开 / 关」文字——
 * 状态由控件自身表达，重复一遍只会让两行看起来更吵。
 */
import { Switch, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface AssistantMemorySwitchesProps {
  autoExtract: boolean;
  inject: boolean;
  saving: boolean;
  onToggleAutoExtract: (checked: boolean) => void;
  onToggleInject: (checked: boolean) => void;
}

export default function AssistantMemorySwitches({
  autoExtract,
  inject,
  saving,
  onToggleAutoExtract,
  onToggleInject,
}: AssistantMemorySwitchesProps) {
  useLocale();

  return (
    <div className="rf-memory-switches">
      <div className="rf-memory-switch-row">
        <div className="rf-memory-switch-copy">
          <Typography.Text strong>{t("assistantMemory.autoExtract.label")}</Typography.Text>
          <Typography.Text type="secondary" className="rf-memory-hint">
            {t("assistantMemory.autoExtract.hint")}
          </Typography.Text>
        </div>
        <Switch
          checked={autoExtract}
          loading={saving}
          aria-label={t("assistantMemory.autoExtract.label")}
          onChange={onToggleAutoExtract}
        />
      </div>
      <div className="rf-memory-switch-row">
        <div className="rf-memory-switch-copy">
          <Typography.Text strong>{t("assistantMemory.inject.label")}</Typography.Text>
          <Typography.Text type="secondary" className="rf-memory-hint">
            {t("assistantMemory.inject.hint")}
          </Typography.Text>
        </div>
        <Switch
          checked={inject}
          loading={saving}
          aria-label={t("assistantMemory.inject.label")}
          onChange={onToggleInject}
        />
      </div>
    </div>
  );
}
