// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Select, Space } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { setLocale } from "../../i18n/localePersistence";
import { SUPPORTED_LOCALES, type Locale } from "../../i18n/localeTypes";

export default function LocaleSettingsCard() {
  const locale = useLocale();
  const [saveFailed, setSaveFailed] = useState(false);

  const changeLocale = async (next: Locale) => {
    setSaveFailed(false);
    try {
      await setLocale(next);
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <div className="settings-locale">
      <Space wrap>
        <Select<Locale>
          aria-label={t("settings.locale.label")}
          value={locale}
          options={SUPPORTED_LOCALES.map((value) => ({
            value,
            label: t(`resume.language.${value}`),
          }))}
          onChange={(value) => void changeLocale(value)}
        />
        <Button aria-label={t("common.action.save")} onClick={() => void changeLocale(locale)}>
          {t("common.action.save")}
        </Button>
      </Space>
      {saveFailed ? <Alert type="error" showIcon title={t("settings.locale.saveFailed")} /> : null}
    </div>
  );
}
