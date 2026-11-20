// SPDX-License-Identifier: Apache-2.0
import { AppstoreOutlined, DownOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  filterNavigationItems,
  pathMatchesNavigationItem,
  SPACE_NAVIGATION_ITEMS,
} from "./navigationConfig";

interface Props {
  hiddenKeys: readonly string[];
}

export default function MySpaceMenu({ hiddenKeys }: Props) {
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const visible = useMemo(
    () => filterNavigationItems(SPACE_NAVIGATION_ITEMS, hiddenKeys, location.pathname),
    [hiddenKeys, location.pathname],
  );
  const items = useMemo<MenuProps["items"]>(() => {
    // t() 是模块级函数，不会自己触发重算；语言变了要重新生成菜单文案。
    void locale;
    return visible.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: t(item.labelKey),
      "aria-label": t(item.labelKey),
    }));
  }, [visible, locale]);
  // 高亮与按钮标题同源：子页（如 /claims/drill）归到所属入口，而不是各自判断一次。
  const currentItem = visible.find((item) => pathMatchesNavigationItem(location.pathname, item));
  const label = currentItem ? t(currentItem.labelKey) : t("navigation.mySpace.label");
  // 可访问名必须以「我的空间」开头：读屏仍能识别这是分组菜单，也是既有测试的定位锚点。
  const ariaLabel = currentItem ? t("navigation.mySpace.currentAria", { name: label }) : label;

  return (
    <Dropdown
      trigger={["click"]}
      // classNames.root 挂到弹出菜单根节点（antd 6 推荐 API，替代已废弃的
      // overlayClassName；Dropdown 没有 popupClassName 属性）。
      classNames={{ root: "rf-nav-dropdown" }}
      menu={{
        items,
        selectedKeys: currentItem ? [currentItem.key] : [],
        onClick: ({ key }) => navigate(String(key)),
      }}
    >
      <Button
        className="app-space-menu-button"
        type="text"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        icon={<AppstoreOutlined />}
      >
        {label} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
