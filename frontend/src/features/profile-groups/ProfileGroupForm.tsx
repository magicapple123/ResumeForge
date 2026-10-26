// SPDX-License-Identifier: Apache-2.0
/**
 * 组编辑（F6）：名称 + 参与清单。组内没有顺序（R-22），基本信息恒参与（R-21）。
 *
 * 纯受控表单：保存/取消由宿主（单弹层）处理；名称 1–40 字符提示、提交中禁用。
 */
import { Button, Checkbox, Input, Typography } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import type { SectionOut } from "../profile-library/types";
import type { GroupBriefOut } from "./types";

interface Props {
  group: GroupBriefOut;
  sections: SectionOut[];
  busy: boolean;
  onSubmit: (name: string, sectionKeys: string[]) => Promise<boolean>;
  onCancel: () => void;
}

export default function ProfileGroupForm({ group, sections, busy, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(group.name);
  const [memberKeys, setMemberKeys] = useState<string[]>(group.participating_keys);

  useEffect(() => {
    setName(group.name);
    setMemberKeys(group.participating_keys);
  }, [group]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const keys = Array.from(new Set(["basic_info", ...memberKeys]));
    await onSubmit(trimmed, keys);
  };

  const options = sections.map((section) => ({
    value: section.key,
    label: section.name,
    disabled: section.key === "basic_info",
  }));

  return (
    <div className="profile-group-form">
      {/* 顶部不再重复组名与「基本信息恒参与」：弹层标题已给「编辑组」，
          参与清单的显示语义由 membersVisibilityHint 单独说明（不与 membersHint 叠两句）。 */}
      <Typography.Text type="secondary">{t("profileGroups.manager.nameLabel")}</Typography.Text>
      <Input
        value={name}
        maxLength={40}
        aria-label={t("profileGroups.manager.nameLabel")}
        placeholder={t("profileGroups.manager.namePlaceholder")}
        onChange={(event) => setName(event.target.value)}
        onPressEnter={() => void submit()}
        style={{ marginTop: 6 }}
      />
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        {t("profileGroups.manager.membersTitle")}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileGroups.manager.membersVisibilityHint")}
      </Typography.Paragraph>
      <Checkbox.Group
        className="profile-group-form-members"
        value={memberKeys}
        options={options}
        onChange={(values) => {
          const next = values as string[];
          if (!next.includes("basic_info")) next.push("basic_info");
          setMemberKeys(next);
        }}
      />
      <div className="profile-group-form-actions">
        <Button onClick={onCancel} disabled={busy}>
          {t("profileGroups.manager.back")}
        </Button>
        <Button type="primary" loading={busy} onClick={() => void submit()}>
          {t("profileGroups.manager.saveMembers")}
        </Button>
      </div>
    </div>
  );
}
