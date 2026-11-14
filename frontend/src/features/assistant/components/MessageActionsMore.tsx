// SPDX-License-Identifier: Apache-2.0
/**
 * 窄档（≤767px）的消息「⋯」操作入口（F37）。
 *
 * 桌面端只保留右键菜单；触屏没有右键，所以窄档额外给一颗按钮，**菜单项与右键完全同一份**
 * （由 `useMessageMenuItems` 生成），不另写一套动作列表。宽档由 CSS 隐藏
 * （`.assistant-message-actions-more` 只在 `@media (max-width: 767px)` 显示）。
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { RowMenuItem } from "../../../components/common/RowActions";
import { useRowActionMenu } from "../../../components/common/rowActionMenu";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export default function MessageActionsMore({ items }: { items: RowMenuItem[] }) {
  useLocale();
  const buildMenu = useRowActionMenu();
  return (
    <div className="assistant-message-actions-more">
      <Dropdown
        menu={{ items: buildMenu(items) }}
        trigger={["click"]}
        placement="topRight"
        // 贴气泡右缘弹出：消息区可滚动，翻上去的旧消息也不会把菜单顶出视口。
        autoAdjustOverflow
      >
        <Button
          type="text"
          size="small"
          aria-label={t("assistantUi.messageActions.more")}
          icon={<MoreOutlined />}
        />
      </Dropdown>
    </div>
  );
}
