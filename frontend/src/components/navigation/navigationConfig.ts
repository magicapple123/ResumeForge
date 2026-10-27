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
import type { MessageKey } from "../../i18n";

export type NavigationGroup = "primary" | "space";

export interface NavigationItem {
  key: string;
  icon: ReactNode;
  labelKey: MessageKey;
  group: NavigationGroup;
  required: boolean;
}

export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    key: "/",
    icon: createElement(HomeOutlined),
    labelKey: "navigation.item.home",
    group: "primary",
    required: true,
  },
  {
    key: "/jobs",
    icon: createElement(SearchOutlined),
    labelKey: "navigation.item.jobs",
    group: "primary",
    required: true,
  },
  {
    key: "/resumes",
    icon: createElement(FileTextOutlined),
    labelKey: "navigation.item.resumes",
    group: "primary",
    required: true,
  },
  {
    key: "/apply",
    icon: createElement(SendOutlined),
    labelKey: "navigation.item.apply",
    group: "primary",
    required: true,
  },
  {
    key: "/webform",
    icon: createElement(FormOutlined),
    labelKey: "navigation.item.webform",
    group: "primary",
    required: false,
  },
  {
    key: "/tracker",
    icon: createElement(FunnelPlotOutlined),
    labelKey: "navigation.item.tracker",
    group: "primary",
    required: false,
  },
  {
    key: "/interview",
    icon: createElement(SolutionOutlined),
    labelKey: "navigation.item.interview",
    group: "primary",
    required: false,
  },
  {
    key: "/assistant",
    icon: createElement(MessageOutlined),
    labelKey: "navigation.item.assistant",
    group: "primary",
    required: false,
  },
  {
    key: "/settings",
    icon: createElement(SettingOutlined),
    labelKey: "navigation.item.settings",
    group: "primary",
    required: true,
  },
  {
    key: "/profile",
    icon: createElement(ProfileOutlined),
    labelKey: "navigation.item.profile",
    group: "space",
    required: true,
  },
  {
    key: "/favorites",
    icon: createElement(StarOutlined),
    labelKey: "navigation.item.favorites",
    group: "space",
    required: false,
  },
  {
    key: "/materials",
    icon: createElement(InboxOutlined),
    labelKey: "navigation.item.materials",
    group: "space",
    required: false,
  },
  {
    key: "/knowledge",
    icon: createElement(BookOutlined),
    labelKey: "navigation.item.knowledge",
    group: "space",
    required: false,
  },
  {
    key: "/skills",
    icon: createElement(ToolOutlined),
    labelKey: "navigation.item.skills",
    group: "space",
    required: false,
  },
  {
    key: "/analytics",
    icon: createElement(BarChartOutlined),
    labelKey: "navigation.item.analytics",
    group: "space",
    required: false,
  },
  {
    key: "/claims",
    icon: createElement(AuditOutlined),
    labelKey: "navigation.item.claims",
    group: "space",
    required: false,
  },
  {
    key: "/trash",
    icon: createElement(DeleteOutlined),
    labelKey: "navigation.item.trash",
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

export function navigationPageLabelKey(pathname: string): MessageKey {
  if (pathname === "/claims/drill") return "navigation.page.claimsDrill";
  return (
    NAVIGATION_ITEMS.find((item) => pathMatchesNavigationItem(pathname, item))?.labelKey ??
    "navigation.item.home"
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
