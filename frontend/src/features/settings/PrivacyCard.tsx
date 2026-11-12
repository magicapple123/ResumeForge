// SPDX-License-Identifier: Apache-2.0
/** 设置页「数据」分页的「隐私与数据主权」卡片：把隐私承诺说成用户看得懂的条款。 */

import { Card, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function PrivacyCard() {
  useLocale();
  return (
    <Card title={t("settingsUi.privacy.title")} className="settings-card">
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        {t("settingsUi.privacy.localLead")}
        <strong>{t("settingsUi.privacy.localStrong")}</strong>
        {t("settingsUi.privacy.localTail")}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("settingsUi.privacy.ai")}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        <strong>{t("settingsUi.privacy.exportStrong")}</strong>
        {t("settingsUi.privacy.exportBody")}
        <strong>{t("settingsUi.privacy.deleteStrong")}</strong>
        {t("settingsUi.privacy.deleteBody")}
      </Typography.Paragraph>
    </Card>
  );
}
