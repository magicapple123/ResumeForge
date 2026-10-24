// SPDX-License-Identifier: Apache-2.0
/**
 * 辅助线开关（D05）：页边距线 / 列边界 / 基线 / 段落边界。
 *
 * 四条互相独立；按钮上显示"开了几项"，弹层里逐条勾选。**只在预览里生效**，
 * 所以弹层底部常驻一句"不会进入导出"——这是这条功能唯一的承诺，不能只写在代码注释里。
 */
import { BorderOutlined } from "@ant-design/icons";
import { Button, Checkbox, Popover, Space, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import { enabledGuideCount, type GuideFlags } from "../../../features/resume-proview/types";

interface GuideItem {
  key: keyof GuideFlags;
  labelKey: MessageKey;
}

const GUIDE_ITEMS: readonly GuideItem[] = [
  { key: "margins", labelKey: "proview.guides.margins" },
  { key: "columns", labelKey: "proview.guides.columns" },
  { key: "baselines", labelKey: "proview.guides.baselines" },
  { key: "paragraphs", labelKey: "proview.guides.paragraphs" },
];

interface Props {
  value: GuideFlags;
  onChange: (next: GuideFlags) => void;
}

export default function GuidesControl({ value, onChange }: Props) {
  const count = enabledGuideCount(value);
  const content = (
    <Space direction="vertical" size={6} style={{ maxWidth: 260 }}>
      {GUIDE_ITEMS.map((item) => (
        <Checkbox
          key={item.key}
          checked={value[item.key]}
          onChange={(event) => onChange({ ...value, [item.key]: event.target.checked })}
        >
          {t(item.labelKey)}
        </Checkbox>
      ))}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("proview.guides.hint")}
      </Typography.Text>
    </Space>
  );
  const label = count > 0 ? t("proview.guides.count", { count }) : t("proview.guides.label");
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      title={t("proview.guides.label")}
      content={content}
    >
      <Tooltip title={t("proview.guides.hint")}>
        <Button
          size="small"
          type={count > 0 ? "primary" : "text"}
          icon={<BorderOutlined />}
          aria-label={label}
        >
          {label}
        </Button>
      </Tooltip>
    </Popover>
  );
}
