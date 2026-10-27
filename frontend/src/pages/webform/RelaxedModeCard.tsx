// SPDX-License-Identifier: Apache-2.0
/**
 * 放宽模式快捷入口（网申填表页顶部，与「AI 兜底卡」并排）。
 *
 * 与设置页的 `WebFormRelaxedModeCard` 是**同一个开关**（后端持久化）：这里给的是
 * 用表单时的就近入口，改完立即生效——下一次预览就会按新边界算。开启前必须把风险
 * 说清楚，且开启状态下持续显示风险文案（不能只在开的那一瞬间提醒一次）。
 */
import { App, Card, Space, Switch, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useWebFormRelaxedMode } from "../../features/settings/useWebFormRelaxedMode";

/**
 * **memo**：本卡无 props，父组件因别处击键重渲时它整块跳过（自身 hook 的状态更新照常生效）。
 */
export const RelaxedModeCard = memo(function RelaxedModeCard() {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这张卡不重渲染。
  useLocale();
  const { message } = App.useApp();
  const { enabled, loading, saving, toggle } = useWebFormRelaxedMode();

  const onChange = async (checked: boolean) => {
    const saved = await toggle(checked);
    if (saved === checked) {
      message.success(
        checked ? t("webFormPage.relaxed.onToast") : t("webFormPage.relaxed.offToast"),
      );
    } else {
      message.error(t("webFormPage.relaxed.saveFailed"));
    }
  };

  return (
    <Card size="small" title={t("webFormPage.relaxed.title")}>
      <Space size="middle" wrap>
        <Switch
          checked={enabled}
          loading={loading || saving}
          onChange={(checked) => void onChange(checked)}
          aria-label={t("webFormPage.relaxed.toggleAria")}
        />
        <Typography.Text type="secondary">
          {t("webFormPage.relaxed.defaultOff")}
          {enabled ? (
            <Typography.Text type="warning">{t("webFormPage.relaxed.enabledHint")}</Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text type="warning">{t("webFormPage.relaxed.risk")}</Typography.Text>
      </Space>
    </Card>
  );
});
