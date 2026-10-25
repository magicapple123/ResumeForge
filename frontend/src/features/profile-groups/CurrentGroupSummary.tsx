// SPDX-License-Identifier: Apache-2.0
/** 当前组只读摘要（R-27/R-58）：生成/新建面板显示「本次使用：组名（N 个大字段）」。 */
import { Tooltip, Typography } from "antd";
import { t } from "../../i18n";

interface Props {
  name: string | null;
  participatingKeys: string[];
  sectionNames: Record<string, string>;
}

export default function CurrentGroupSummary({ name, participatingKeys, sectionNames }: Props) {
  if (!name) {
    return <Typography.Text type="secondary">{t("profileGroups.summary.loading")}</Typography.Text>;
  }
  const fields = participatingKeys.map((key) => sectionNames[key] ?? key);
  return (
    <Tooltip
      title={
        fields.length > 0
          ? fields.join(t("profileGroups.summary.separator"))
          : t("profileGroups.summary.empty")
      }
    >
      <Typography.Text>
        {t("profileGroups.summary.label", {
          name,
          count: participatingKeys.length,
        })}
      </Typography.Text>
    </Tooltip>
  );
}
