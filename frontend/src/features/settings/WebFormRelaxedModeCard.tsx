// SPDX-License-Identifier: Apache-2.0
/**
 * 网申填表「放宽模式」卡（设置页 · 应用）。
 *
 * 默认关。开启前把边界说清楚：程序会代点什么、什么仍然不代做、风险是什么。
 * 文案与后端 `engine.core.relaxed_kind` 的注释同源——那里是代码事实，这里是用户可见的
 * 承诺，两者只许同时改。
 */
import { App, Card, Flex, Space, Switch, Typography } from "antd";
import LoadingBlock from "../../components/common/LoadingBlock";
import { useWebFormRelaxedMode } from "./useWebFormRelaxedMode";
import SettingsResetButton from "./SettingsResetButton";
import { useSettingsResetListener } from "./useSettingsResetListener";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function WebFormRelaxedModeCard() {
  useLocale();
  const { message } = App.useApp();
  const { enabled, loading, saving, toggle, reload } = useWebFormRelaxedMode();

  // I-10：`webform` 作用域只有这一个键，卡片即作用域，按 scope 整组复位。
  useSettingsResetListener(() => void reload());

  const onChange = async (checked: boolean) => {
    const saved = await toggle(checked);
    if (saved === checked) {
      message.success(
        checked
          ? t("settingsUi.webFormRelaxed.enableToast")
          : t("settingsUi.webFormRelaxed.disableToast"),
      );
    } else {
      message.error(t("settingsUi.webFormRelaxed.saveFailed"));
    }
  };

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("settingsUi.webFormRelaxed.title")}</span>
          {/* I-10：卡片级恢复默认（回到「关」）。 */}
          <SettingsResetButton scope="webform" />
        </Flex>
      }
      className="settings-card"
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.webFormRelaxed.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.webFormRelaxed.toggleAria")}
            onChange={(checked) => void onChange(checked)}
          />
          <Typography.Text type={enabled ? "warning" : "secondary"}>
            {t("settingsUi.webFormRelaxed.warning")}
          </Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
