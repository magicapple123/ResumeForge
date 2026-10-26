// SPDX-License-Identifier: Apache-2.0
import { Button, Input, Space, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editing: boolean;
  filledCount: number;
  totalCount: number;
  searchTerm: string;
  showOnlyFilled: boolean;
  onSearchChange: (value: string) => void;
  onToggleShowOnlyFilled: () => void;
  /** 打开「粘贴文本识别」（项 12）。只有编辑态渲染入口。 */
}

export default function WebFormProfileToolbar({
  editing,
  filledCount,
  totalCount,
  searchTerm,
  showOnlyFilled,
  onSearchChange,
  onToggleShowOnlyFilled,
}: Props) {
  useLocale();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 14,
        padding: "10px 12px",
        border: "1px solid var(--rf-border)",
        borderRadius: 10,
        background: "var(--rf-brand-wash)",
      }}
    >
      <Space size="small" wrap>
        <Tag color={filledCount ? "blue" : "default"}>
          {t("profileLibrary.webform.filledCount", { count: filledCount, total: totalCount })}
        </Tag>
        <Typography.Text type="secondary">
          {t(editing ? "profileLibrary.webform.editingHint" : "profileLibrary.webform.viewingHint")}
        </Typography.Text>
      </Space>
      <Space size="small" wrap>
        <Input
          allowClear
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("profileLibrary.webform.toolbarSearchPlaceholder")}
          aria-label={t("profileLibrary.webform.toolbarSearchLabel")}
          style={{ width: 220 }}
        />
        {editing ? (
          <Button
            size="small"
            type={showOnlyFilled ? "primary" : "default"}
            onClick={onToggleShowOnlyFilled}
          >
            {t(
              showOnlyFilled
                ? "profileLibrary.webform.showAllFields"
                : "profileLibrary.webform.showFilledFields",
            )}
          </Button>
        ) : null}
        {/* 「粘贴文本识别」已移到页头（与简历资料侧同一个位置，切换分页即换目标），
            这里不再放第二个入口。 */}
      </Space>
    </div>
  );
}
