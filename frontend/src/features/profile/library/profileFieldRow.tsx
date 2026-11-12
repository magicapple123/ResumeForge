// SPDX-License-Identifier: Apache-2.0
/**
 * 自定义字段的一行（问题 18 的 ②③⑥）：常驻「位置下拉 + 仅素材」，改名/删除进 ⋯。
 *
 * 行高从 ~86px 压到 ~56px：字段名与动作收进头部一行（24px），位置控件单独一行（22px），
 * 不再有行内 inline margin。
 *
 * 改名态由本组件自持（每行独立），删除确认条留在宿主：它要先取影响面再展示
 * 「动作 + 条数 + 保留后果 + 恢复位置」，是跨行的状态。
 *
 * 7-A：行尾补上与默认字段**同形态**的隐藏开关。此前只有默认字段有隐藏入口，自建字段
 * 想"暂时不用"只能删掉（连定义和已填内容一起丢）。后端早就支持（patch_preference 对
 * 自建字段走 active_custom_field 归属校验、MergedField.hidden 对自建字段同样生效），
 * 缺的只是这一颗开关。
 *
 * 「仅素材」与「隐藏」是两个独立概念，绝不合并：
 * - 仅素材：不上纸面，但值仍进模型 / 网申（`columnStrategySelect` 里的可见文字开关）；
 * - 隐藏：完全不参与（不显示、不进生成与投影、也不进全局搜索）。
 * 两者都写在字段定义/偏好里的不同列上，UI 上必须能看出是两件事。
 */
import { Button, Input, Switch, Tag, Tooltip } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import ColumnStrategySelect from "./columnStrategySelect";
import { profileFieldLabel, profileFieldTypeLabel } from "./profileLabels";
import { profilePlacementLabel } from "./fieldPlacement";
import SettingsMoreMenu from "./settingsMoreMenu";
import type { Placement } from "../../../types/resumeDocument";
import type { FieldOut } from "./types";

interface Props {
  field: FieldOut;
  busy: boolean;
  onRename: (label: string) => void;
  onDelete: () => void;
  onChangePlacement: (value: string) => void;
  onChangeMaterialOnly: (checked: boolean) => void;
  /** 隐藏开关（7-A）：与默认字段同一份偏好写路径，只差画在哪个组件里。 */
  onToggleHidden: (hidden: boolean) => void;
  /**
   * 本字段是否是自建板块的**主文本字段**（`paper_policy.custom_section_text_field` 的同一
   * 判定：宿主传 `section.carrier_field_id`，自建板块里它就是 primary_field_id）。
   * 隐藏它不会丢内容——投影会退回「标签：值」逐行呈现——但正文段落会消失，所以标注出来。
   */
  primaryText?: boolean;
}

export default function ProfileFieldRow({
  field,
  busy,
  onRename,
  onDelete,
  onChangePlacement,
  onChangeMaterialOnly,
  onToggleHidden,
  primaryText = false,
}: Props) {
  useLocale();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  const submitRename = () => {
    const label = draft.trim();
    if (!label) return;
    onRename(label);
    setRenaming(false);
  };

  const materialOnly = field.material_only === true;
  const placement = (field.effective_placement ?? field.default_placement ?? "") as Placement | "";

  return (
    <div className="profile-settings-row profile-field-row">
      <div className="profile-field-row-head">
        {renaming ? (
          <Input
            value={draft}
            maxLength={40}
            aria-label={t("profileLibrary.fieldSettings.rename")}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={submitRename}
            style={{ maxWidth: 260 }}
          />
        ) : (
          <span className="profile-settings-row-main">
            <span className="profile-settings-row-title">{profileFieldLabel(field)}</span>
            <span className="profile-settings-row-meta">{profileFieldTypeLabel(field)}</span>
            <Tag>{profilePlacementLabel(field.effective_placement ?? field.default_placement)}</Tag>
            {primaryText ? (
              <Tooltip title={t("profileLibrary.fieldSettings.primaryTextFieldHint")}>
                <Tag color="blue">{t("profileLibrary.fieldSettings.primaryTextField")}</Tag>
              </Tooltip>
            ) : null}
            {field.material_only ? (
              <Tag color="red">{t("structure.profile.materialOnlyShort")}</Tag>
            ) : null}
          </span>
        )}
        <span className="profile-settings-row-actions">
          {renaming ? (
            <Button size="small" type="primary" loading={busy} onClick={submitRename}>
              {t("profileLibrary.fieldSettings.saveName")}
            </Button>
          ) : (
            <SettingsMoreMenu
              label={t("profileLibrary.fieldSettings.more")}
              disabled={busy}
              actions={[
                {
                  key: "rename",
                  label: t("profileLibrary.fieldSettings.renameMenu"),
                  onSelect: () => {
                    setDraft(field.label);
                    setRenaming(true);
                  },
                },
                {
                  key: "delete",
                  label: t("profileLibrary.fieldSettings.deleteMenu"),
                  danger: true,
                  onSelect: onDelete,
                },
              ]}
            />
          )}
          {/* 隐藏开关放最右：默认字段行的开关也在最右，两处右边缘对齐成同一列。
              aria-label 与默认字段同一家族（hideAria/showAria），读屏口径不分裂。 */}
          <Switch
            size="small"
            checked={!field.hidden}
            aria-label={
              field.hidden
                ? t("profileLibrary.fieldSettings.showAria", { label: profileFieldLabel(field) })
                : t("profileLibrary.fieldSettings.hideAria", { label: profileFieldLabel(field) })
            }
            disabled={busy || undefined}
            onChange={(checked) => onToggleHidden(!checked)}
          />
        </span>
      </div>
      <ColumnStrategySelect
        value={field.default_placement ?? ""}
        effectivePlacement={placement}
        materialOnly={materialOnly}
        busy={busy}
        onChangePlacement={onChangePlacement}
        onChangeMaterialOnly={onChangeMaterialOnly}
      />
    </div>
  );
}
