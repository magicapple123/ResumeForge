// SPDX-License-Identifier: Apache-2.0
/**
 * 升级告知（R-47）：检测到旧资料存在而新模型为空时，在资料页顶部如实说明。
 *
 * 不静默显示空资料页、不加永久 dismiss；给"打开备份"与"开始填写"两条出路。
 * 新模型一旦有数据（服务端 new_profile_has_entries=true）自然消失。
 */
import { Alert, Button, Space } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  hasLegacyData: boolean;
  newProfileHasEntries: boolean;
  onOpenBackup: () => void;
  onStartFill: () => void;
}

export default function ProfileUpgradeNotice({
  hasLegacyData,
  newProfileHasEntries,
  onOpenBackup,
  onStartFill,
}: Props) {
  useLocale();
  if (!hasLegacyData || newProfileHasEntries) return null;
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      title={t("profileLibrary.upgrade.title")}
      description={t("profileLibrary.upgrade.body")}
      action={
        <Space orientation="vertical" size={8}>
          <Button size="small" onClick={onOpenBackup}>
            {t("profileLibrary.upgrade.backup")}
          </Button>
          <Button size="small" type="primary" onClick={onStartFill}>
            {t("profileLibrary.upgrade.start")}
          </Button>
        </Space>
      }
    />
  );
}
