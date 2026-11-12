// SPDX-License-Identifier: Apache-2.0
import { AppstoreOutlined, DownOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { filterNavigationItems, SPACE_NAVIGATION_ITEMS } from "./navigationConfig";

interface Props {
  hiddenKeys: readonly string[];
}

export default function MySpaceMenu({ hiddenKeys }: Props) {
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const items = useMemo<MenuProps["items"]>(() => {
    // t() 是模块级函数，不会自己触发重算；语言变了要重新生成菜单文案。
    void locale;
    const visible = filterNavigationItems(SPACE_NAVIGATION_ITEMS, hiddenKeys, location.pathname);
    return visible.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: t(item.labelKey),
      "aria-label": t(item.labelKey),
    }));
  }, [hiddenKeys, location.pathname, locale]);
  const selectedKey = SPACE_NAVIGATION_ITEMS.find((item) =>
    item.key === "/" ? location.pathname === "/" : location.pathname.startsWith(item.key),
  )?.key;

  return (
    <Dropdown
      trigger={["click"]}
      // classNames.root 挂到弹出菜单根节点（antd 6 推荐 API，替代已废弃的
      // overlayClassName；Dropdown 没有 popupClassName 属性）。
      classNames={{ root: "rf-nav-dropdown" }}
      menu={{
        items,
        selectedKeys: selectedKey ? [selectedKey] : [],
        onClick: ({ key }) => navigate(String(key)),
      }}
    >
      <Button
        className="app-space-menu-button"
        type="text"
        aria-label={t("navigation.mySpace.label")}
        aria-haspopup="menu"
        icon={<AppstoreOutlined />}
      >
        {t("navigation.mySpace.label")} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
