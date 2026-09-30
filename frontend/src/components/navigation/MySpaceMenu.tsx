import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { filterNavigationItems, SPACE_NAVIGATION_ITEMS } from "./navigationConfig";

interface Props {
  hiddenKeys: readonly string[];
}

export default function MySpaceMenu({ hiddenKeys }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const items = useMemo<MenuProps["items"]>(() => {
    const visible = filterNavigationItems(SPACE_NAVIGATION_ITEMS, hiddenKeys, location.pathname);
    return visible.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label,
    }));
  }, [hiddenKeys, location.pathname]);
  const selectedKey = SPACE_NAVIGATION_ITEMS.find((item) =>
    item.key === "/" ? location.pathname === "/" : location.pathname.startsWith(item.key),
  )?.key;

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items,
        selectedKeys: selectedKey ? [selectedKey] : [],
        onClick: ({ key }) => navigate(String(key)),
      }}
    >
      <Button className="app-space-menu-button" type="text" aria-haspopup="menu">
        我的空间 <DownOutlined />
      </Button>
    </Dropdown>
  );
}
