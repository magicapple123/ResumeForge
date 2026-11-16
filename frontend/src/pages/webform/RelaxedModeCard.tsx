// SPDX-License-Identifier: Apache-2.0
/**
 * 放宽模式行（网申填表页「怎么填」面板第 2 行）。
 *
 * 与设置页的 `WebFormRelaxedModeCard` 是**同一个开关**（后端持久化）：这里给的是
 * 用表单时的就近入口，改完立即生效——下一次预览就会按新边界算。
 *
 * I-11 之后它是 `FillModePanel` 的一行（无卡片外壳），且**不参与任何折叠**。
 * 风险文案的位置在 I-27 调整过：四类「始终不代填」压成一行常驻边界条（`FillModePanel`
 * 底部，默认态可见），"存在选错可能，填完请核对"与逐条解释收进那条边界条旁边的 ⓘ。
 * 这样默认态仍看得见边界，又不必为一段两百字的说明永久占掉左栏两屏中的三分之一。
 */
import { App, Switch, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useWebFormRelaxedMode } from "../../features/settings/useWebFormRelaxedMode";

/**
 * **memo**：本组件无 props，父组件因别处击键重渲时它整块跳过（自身 hook 的状态更新照常生效）。
 */
export const RelaxedModeCard = memo(function RelaxedModeCard() {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这一行的文案不重渲染。
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
    <div className="webform-mode-row">
      <span className="webform-mode-label">{t("webFormPage.relaxed.title")}</span>
      <div className="webform-mode-control">
        <Switch
          checked={enabled}
          loading={loading || saving}
          onChange={(checked) => void onChange(checked)}
          aria-label={t("webFormPage.relaxed.toggleAria")}
        />
      </div>
      <div className="webform-mode-hint">
        {/* 两种状态各说一句：开启后还留着「默认关闭：…」会让这一行变成三行，
            而且那句话对已经开着的用户没有任何信息量。 */}
        {enabled ? (
          <Typography.Text type="warning" className="relaxed-mode-enabled-hint">
            {t("webFormPage.relaxed.enabledHint")}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("webFormPage.relaxed.defaultOff")}
          </Typography.Text>
        )}
      </div>
    </div>
  );
});
