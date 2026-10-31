// SPDX-License-Identifier: Apache-2.0
/**
 * 文档编辑器的板块页签（含固定在最前的「基本信息」）。
 *
 * 复用制作台既有的 `EditorTabStrip`：溢出时那颗三角按钮的层级、键盘方向键切换、
 * 指示条动画都已经处理过，不再造第二份。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { TabsProps } from "antd";
import { useI18n } from "../../i18n/i18nContext";
import EditorTabStrip from "./EditorTabStrip";

export interface DocumentSectionTabItem {
  key: string;
  label: string;
}

interface Props {
  items: DocumentSectionTabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  readOnly?: boolean;
  onAddSection?: () => void;
}

export default function DocumentSectionTabs({
  items,
  activeKey,
  onSelect,
  readOnly = false,
  onAddSection,
}: Props) {
  const { t } = useI18n();
  const tabItems: TabsProps["items"] = items.map((item) => ({ key: item.key, label: item.label }));
  return (
    <div className="document-tabs">
      <EditorTabStrip items={tabItems} activeKey={activeKey} onSelect={onSelect} />
      {onAddSection && !readOnly ? (
        <Tooltip title={t("document.tabs.add")}>
          <Button
            className="document-tabs-add"
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label={t("document.tabs.add")}
            onClick={onAddSection}
          />
        </Tooltip>
      ) : null}
    </div>
  );
}
