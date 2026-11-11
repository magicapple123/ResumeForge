// SPDX-License-Identifier: Apache-2.0
/**
 * 投投页面上下文：路由级默认值 + 页面注册值（#27B）。
 *
 * 两层来源合成一份：
 * 1. `buildRoutePageContext(pathname)`：每个路由的前 5 个动作（`touTouRouteCatalog`）；
 * 2. `registerTouTouContext` 登记的实时上下文（页面自己知道得更准）。
 *
 * 后者的动作/信号按 id 覆盖前者；标题也是后者优先。所以页面什么都不用做就有一份
 * 可用的"本页动作"，想补充时再登记。
 */
import { useLocation } from "react-router-dom";
import { buildRoutePageContext } from "./touTouRouteCatalog";
import { useRegisteredTouTouContext } from "./touTouPageContext";
import { mergeTouTouPageContexts, type TouTouPageContext } from "./touTouPageContext";

export function useTouTouPageContext(): TouTouPageContext {
  const { pathname } = useLocation();
  const registered = useRegisteredTouTouContext();
  return mergeTouTouPageContexts([buildRoutePageContext(pathname), registered]);
}
