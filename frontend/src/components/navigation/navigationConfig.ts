// SPDX-License-Identifier: Apache-2.0
import {
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FormOutlined,
  FunnelPlotOutlined,
  HomeOutlined,
  InboxOutlined,
  MessageOutlined,
  ProfileOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SolutionOutlined,
  StarOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { createElement, type ReactNode } from "react";

export type NavigationGroup = "primary" | "space";

export interface NavigationItem {
  key: string;
  icon: ReactNode;
  label: string;
  group: NavigationGroup;
  required: boolean;
}

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { key: "/", icon: createElement(HomeOutlined), label: "首页", group: "primary", required: true },
  {
    key: "/jobs",
    icon: createElement(SearchOutlined),
    label: "岗位广场",
    group: "primary",
    required: true,
  },
  {
    key: "/resumes",
    icon: createElement(FileTextOutlined),
    label: "简历中心",
    group: "primary",
    required: true,
  },
  {
    key: "/apply",
    icon: createElement(SendOutlined),
    label: "投递台",
    group: "primary",
    required: true,
  },
  {
    key: "/webform",
    icon: createElement(FormOutlined),
    label: "网申填表",
    group: "primary",
    required: false,
  },
  {
    key: "/tracker",
    icon: createElement(FunnelPlotOutlined),
    label: "求职进度",
    group: "primary",
    required: false,
  },
  {
    key: "/interview",
    icon: createElement(SolutionOutlined),
    label: "模拟面试",
    group: "primary",
    required: false,
  },
  {
    key: "/assistant",
    icon: createElement(MessageOutlined),
    label: "求职助手",
    group: "primary",
    required: false,
  },
  {
    key: "/settings",
    icon: createElement(SettingOutlined),
    label: "设置",
    group: "primary",
    required: true,
  },
  {
    key: "/profile",
    icon: createElement(ProfileOutlined),
    label: "我的资料",
    group: "space",
    required: true,
  },
  {
    key: "/favorites",
    icon: createElement(StarOutlined),
    label: "收藏夹",
    group: "space",
    required: false,
  },
  {
    key: "/materials",
    icon: createElement(InboxOutlined),
    label: "资料箱",
    group: "space",
    required: false,
  },
  {
    key: "/knowledge",
    icon: createElement(BookOutlined),
    label: "知识库",
    group: "space",
    required: false,
  },
  {
    key: "/skills",
    icon: createElement(ToolOutlined),
    label: "工作台",
    group: "space",
    required: false,
  },
  {
    key: "/analytics",
    icon: createElement(BarChartOutlined),
    label: "求职统计",
    group: "space",
    required: false,
  },
  {
    key: "/claims",
    icon: createElement(AuditOutlined),
    label: "事实台账",
    group: "space",
    required: false,
  },
  {
    key: "/trash",
    icon: createElement(DeleteOutlined),
    label: "回收站",
    group: "space",
    required: false,
  },
];

export const MENU_ITEMS = NAVIGATION_ITEMS;
export const PRIMARY_NAVIGATION_ITEMS = NAVIGATION_ITEMS.filter((item) => item.group === "primary");
export const SPACE_NAVIGATION_ITEMS = NAVIGATION_ITEMS.filter((item) => item.group === "space");
export const CORE_NAVIGATION_KEYS = new Set(
  NAVIGATION_ITEMS.filter((item) => item.required).map((item) => item.key),
);

export function pathMatchesNavigationItem(pathname: string, item: NavigationItem): boolean {
  return item.key === "/"
    ? pathname === "/"
    : pathname === item.key || pathname.startsWith(item.key + "/");
}

export function navigationPageLabel(pathname: string): string {
  if (pathname === "/claims/drill") return "事实核对";
  return (
    NAVIGATION_ITEMS.find((item) => pathMatchesNavigationItem(pathname, item))?.label ?? "首页"
  );
}

export function filterNavigationItems(
  items: NavigationItem[],
  hiddenKeys: readonly string[],
  pathname: string,
): NavigationItem[] {
  const hidden = new Set(hiddenKeys);
  return items.filter(
    (item) => item.required || !hidden.has(item.key) || pathMatchesNavigationItem(pathname, item),
  );
}
