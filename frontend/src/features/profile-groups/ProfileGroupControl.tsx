// SPDX-License-Identifier: Apache-2.0
/**
 * 资料页标题区的「当前组」控件（F6/R-52）：一个下拉 + 一个「管理组」按钮。
 *
 * 不新增 Tabs；编辑态禁用切换并给 Tooltip 原因（R-26）；切换成功后由宿主重取 workspace。
 */
import { Button, Select, Tooltip } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { t } from "../../i18n";
import type { GroupBriefOut } from "./types";

interface Props {
  groups: GroupBriefOut[];
  currentGroupId: string | null;
  editing: boolean;
  busy: boolean;
  sectionNames: Record<string, string>;
  onSwitch: (groupId: string) => void;
  onManage: () => void;
}

export default function ProfileGroupControl({
  groups,
  currentGroupId,
  editing,
  busy,
  sectionNames,
  onSwitch,
  onManage,
}: Props) {
  const editingHint = editing ? t("profileGroups.control.locked") : undefined;
  const options = groups.map((group) => {
    const names = group.participating_keys
      .map((key) => sectionNames[key] ?? key)
      .join(t("profileGroups.summary.separator"));
    return { value: group.group_id, label: group.name, title: names };
  });
  return (
    <div className="profile-group-control">
      <span className="profile-group-control-label">{t("profileGroups.control.label")}</span>
      <Tooltip title={editingHint}>
        <Select
          aria-label={t("profileGroups.control.label")}
          value={currentGroupId ?? undefined}
          options={options}
          loading={busy}
          disabled={editing || busy}
          style={{ width: 200 }}
          onChange={(value) => onSwitch(String(value))}
        />
      </Tooltip>
      <Button icon={<SettingOutlined />} disabled={busy} onClick={onManage}>
        {t("profileGroups.control.manage")}
      </Button>
    </div>
  );
}
