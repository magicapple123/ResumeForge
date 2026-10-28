// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页 · 界面语言。
 *
 * 设计要点：
 * 1. **没有「保存」按钮**：语言切换是即时的（点下去就换、同时落库），再要求点一次保存只是
 *    让用户怀疑"刚才那下到底生效了没有"。失败时用一行红字说明，并把选中态退回语言 store
 *    的当前值，界面与实际状态不会各说一套。
 * 2. **做成两张可点选的卡片而不是下拉**：只有两种语言时，下拉要多点一次才看得到另一个选项，
 *    而卡片把"有哪些语言、现在选的是哪个"一次说清（下拉只显示当前值）。
 * 3. 卡片里带一句该语言的说明——只写「中文 / English」用户不知道它影响什么（界面文案？
 *    简历正文？导出？），而这恰恰是最容易误解的地方。
 * 4. **外面必须有自己的 `Card` 外壳**：这一块要和「简历字体」「界面与导航」平级摆在同一
 *    个设置页签里，那两张都是 `Card`。此前它只是一个裸 `div.settings-locale`，视觉上既不像
 *    一张卡、也和邻居对不齐。外壳只提供标题与间距，里面的选择逻辑一个字没改（点一下即时
 *    保存，仍然没有「保存」按钮）。
 */
import { CheckCircleFilled } from "@ant-design/icons";
import { Alert, Card, Spin } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { setLocale } from "../../i18n/localePersistence";
import { SUPPORTED_LOCALES, type Locale } from "../../i18n/localeTypes";

/** 语言的显示名复用语种自己的词条（`resume.language.*`），不另造一套翻译。 */
function localeName(value: Locale): string {
  return t(`resume.language.${value}`);
}

function localeDescription(value: Locale): string {
  return value === "zh-CN" ? t("settings.locale.option.zh-CN") : t("settings.locale.option.en-US");
}

export default function LocaleSettingsCard() {
  const locale = useLocale();
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState<Locale | null>(null);

  const changeLocale = async (next: Locale) => {
    if (next === locale) return;
    setSaveFailed(false);
    setSaving(next);
    try {
      await setLocale(next);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="settings-card settings-locale-card" title={t("settings.locale.title")}>
      <div className="settings-locale">
        <div
          className="settings-locale-options"
          role="radiogroup"
          aria-label={t("settings.locale.label")}
        >
          {SUPPORTED_LOCALES.map((value) => {
            const active = value === locale;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={localeName(value)}
                className={`settings-locale-option${active ? " is-active" : ""}`}
                disabled={saving !== null}
                onClick={() => void changeLocale(value)}
              >
                <span className="settings-locale-option-head">
                  <span className="settings-locale-option-name">{localeName(value)}</span>
                  {saving === value ? (
                    <Spin size="small" />
                  ) : active ? (
                    <CheckCircleFilled className="settings-locale-option-check" />
                  ) : null}
                </span>
                <span className="settings-locale-option-desc">{localeDescription(value)}</span>
              </button>
            );
          })}
        </div>
        <p className="settings-locale-hint">{t("settings.locale.autoSaveHint")}</p>
        {saveFailed ? (
          <Alert type="error" showIcon title={t("settings.locale.saveFailed")} />
        ) : null}
      </div>
    </Card>
  );
}
