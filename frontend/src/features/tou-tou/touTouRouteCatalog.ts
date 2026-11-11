// SPDX-License-Identifier: Apache-2.0
/**
 * 路由 → 本页动作（#27B / #27C）。
 *
 * 页面感知的第一层是**路由级默认值**：每个已注册路由都有"这一页能做什么"的清单，
 * 球和动作面板在页面没显式调用 `registerTouTouContext` 时也能工作。页面自己的注册
 * （`touTouPageContext`）在运行时覆盖/补充这一层——先有默认值，再谈精确值。
 *
 * 标题复用页头导航的 `navigationPageLabelKey`：同一个页面在页头与面板里不能叫两个
 * 名字（这也是"引用别处文案必须逐字一致"的硬约束）。
 *
 * 路由清单与 `appRoutes.tsx` 的一致性由测试从 `APP_ROOT_ROUTE` 反推：新增路由却
 * 忘了登记动作，测试会直接点名。
 */
import { navigationPageLabelKey } from "../../components/navigation/navigationConfig";
import type { TouTouActionId } from "./touTouActions";
import { resolveTouTouActions } from "./touTouActions";
import type { TouTouPageContext } from "./touTouPageContext";

interface RouteActions {
  path: string;
  actions: readonly TouTouActionId[];
}

/**
 * 每个路由的前 5 个动作（面板只展示前 5 个，更多靠"搜索全部"）。
 *
 * 挑选标准：先给"这一页最相关的一步"，再给两个邻近流程的跳转，最后是剪贴板/助手入口。
 * `/claims/drill` 与 `/resumes/external` 必须排在它们的父路径之前——匹配按最长前缀。
 */
const ROUTE_ACTIONS: readonly RouteActions[] = [
  { path: "/", actions: ["open-assistant", "side-ask", "go-jobs", "go-apply", "open-clipboard"] },
  {
    path: "/jobs",
    actions: ["open-assistant", "side-ask", "go-favorites", "go-apply", "open-clipboard"],
  },
  {
    path: "/resumes/external",
    actions: ["open-assistant", "side-ask", "go-resumes", "open-clipboard"],
  },
  {
    path: "/resumes",
    actions: ["open-assistant", "side-ask", "go-materials", "go-profile", "open-clipboard"],
  },
  {
    path: "/apply",
    actions: ["open-assistant", "side-ask", "go-jobs", "go-favorites", "open-clipboard"],
  },
  { path: "/webform", actions: ["open-assistant", "side-ask", "go-profile", "open-clipboard"] },
  {
    path: "/tracker",
    actions: ["open-assistant", "side-ask", "go-apply", "go-interview", "open-clipboard"],
  },
  {
    path: "/analytics",
    actions: ["open-assistant", "side-ask", "go-apply", "go-tracker", "open-clipboard"],
  },
  {
    path: "/favorites",
    actions: ["open-assistant", "side-ask", "go-jobs", "go-apply", "open-clipboard"],
  },
  {
    path: "/assistant",
    actions: ["side-ask", "open-clipboard", "go-profile", "go-resumes", "go-jobs"],
  },
  {
    path: "/materials",
    actions: ["open-assistant", "side-ask", "go-knowledge", "go-resumes", "open-clipboard"],
  },
  {
    path: "/knowledge",
    actions: ["open-assistant", "side-ask", "go-materials", "go-interview", "open-clipboard"],
  },
  {
    path: "/skills",
    actions: ["open-assistant", "side-ask", "go-resumes", "go-knowledge", "open-clipboard"],
  },
  {
    path: "/interview",
    actions: ["open-assistant", "side-ask", "go-claims", "go-tracker", "open-clipboard"],
  },
  {
    path: "/profile",
    actions: ["side-ask", "open-clipboard", "go-resumes", "go-materials", "open-assistant"],
  },
  {
    path: "/claims",
    actions: ["open-assistant", "side-ask", "go-interview", "go-resumes", "open-clipboard"],
  },
  { path: "/claims/drill", actions: ["open-assistant", "side-ask", "go-claims", "open-clipboard"] },
  { path: "/settings", actions: ["side-ask", "open-assistant", "open-clipboard", "go-profile"] },
  {
    path: "/trash",
    actions: ["open-assistant", "side-ask", "go-resumes", "go-jobs", "open-clipboard"],
  },
];

const FALLBACK_PATH = "/";

/** 命中的路由条目：精确路径优先，其次最长前缀（`/claims/drill` 不会被 `/claims` 抢走）。 */
function routeEntryFor(pathname: string): RouteActions {
  const exact = ROUTE_ACTIONS.find((entry) => entry.path === pathname);
  if (exact) return exact;
  let best: RouteActions | null = null;
  for (const entry of ROUTE_ACTIONS) {
    if (entry.path === "/") continue;
    if (pathname === entry.path || pathname.startsWith(entry.path + "/")) {
      if (!best || entry.path.length > best.path.length) best = entry;
    }
  }
  return best ?? ROUTE_ACTIONS.find((entry) => entry.path === FALLBACK_PATH) ?? ROUTE_ACTIONS[0];
}

/** 本页前 5 个动作 id（面板与测试用）。 */
export function routeActionIds(pathname: string): readonly TouTouActionId[] {
  return routeEntryFor(pathname).actions.slice(0, 5);
}

/** 路由级默认页面上下文（页面没有注册时使用）。 */
export function buildRoutePageContext(pathname: string): TouTouPageContext {
  return {
    titleKey: navigationPageLabelKey(pathname),
    actions: resolveTouTouActions(routeActionIds(pathname)),
    signals: [],
  };
}

/** 已登记动作的路由清单（测试用它和 `APP_ROOT_ROUTE` 对账）。 */
export const TOU_TOU_ROUTE_PATHS: readonly string[] = ROUTE_ACTIONS.map((entry) => entry.path);
